# Education Time Closure Handoff

## Current task

**Education time-close package — EDU-TIME-01 through EDU-TIME-03 are complete; EDU-TIME-04 local acceptance is complete.**

- Worktree: `C:\Users\Plotva\.codex\worktrees\education-time-close\EventGenix`
- Handoff: `docs/EDUCATION_TIME_CLOSE_HANDOFF.md`
- Branch: `codex/education-time-close`
- Verified base SHA: `db9485256740bf1d1b8f90ddda4e5b2069ead03e`
- Fresh production check: version `0.82.81`; branch `codex/eventgenix-production`; exact SHA `db9485256740bf1d1b8f90ddda4e5b2069ead03e`; deployment manifest complete.
- Runtime: Node `22.23.1`, npm `10.9.8`; `npm run check:runtime` passed.
- Main checkout: inspected and left untouched. It remains dirty and far behind the verified production branch.
- No dependency or lockfile changes, schema, permissions, protected-surface manifest, or production business writes. Current delivery preparation is recorded below.

## EDU-TIME-01 bug report and root cause (written before product edit)

- **Symptom:** A series lesson whose Kyiv wall-clock time has passed may be accepted when the Node process timezone is UTC, while a single lesson at the same Kyiv date/time is rejected.
- **Expected:** Series and single lesson writes apply the same explicit `Europe/Kyiv` past-time rule, independent of host timezone.
- **Actual source behavior:** `POST /api/bookings/education-series` parsed `${date}T${time}` with `new Date(...)`, which interprets an offset-free datetime in the process timezone. The single-booking route calls `bookingPastValidationError`, using `bookingKyivClock` and `Europe/Kyiv` semantics.
- **Pre-edit deterministic reproduction:** At `now=2026-10-13T16:07:32Z` (19:07 Kyiv), candidate `2026-10-13 18:00` parsed to `18:00Z` and was treated as future under `TZ=UTC`; it parsed to `15:00Z` and was treated as past under `TZ=Europe/Kyiv`. A Node reproduction returned `isPast=false` under UTC and `isPast=true` under Kyiv.
- **Root cause:** The series route bypassed the shared Kyiv-aware validator and compared process-local `Date` values. CI's host timezone had been Kyiv, masking the UTC branch.
- **Actual-app baseline limitation:** Express → disposable PostgreSQL reproduction was not available locally. `TEST_DATABASE_URL` is absent; the isolated runner failed closed before connecting with `TEST_DATABASE_URL is required; DATABASE_URL is never used as a fallback`. No PostgreSQL process or listener was observed on ports 5432/55469. Windows service enumeration was denied to this session, so service inventory is unknown. Docker CLI is installed, but its Docker Desktop Linux engine pipe is unavailable. Both TEST_DATABASE_URL and DATABASE_URL are absent; the isolated runner must remain fail-closed. Production was not used.
- **Protected surface:** `docs/TIMELINE_PROTECTED_SURFACE.md` was read. This fix changes only past-time validation; booking identity, detail priorities, renderer ownership, timeline projection and all six protected hashes remain untouched. Do not edit the protected manifest.

## Implementation

- `routes/bookings.js`: replaced the series route's process-local `new Date` comparison with `bookingPastValidationError(candidate)`, the same validator used by single-booking writes.
- `tests/integration/education-series.integration.test.js`: added an actual-app + SQL regression comparing a single lesson and series at the same past Kyiv time, including an assertion that no occurrence is persisted.
- `scripts/run-isolated-postgres-tests.js` and `tests/helpers/education-series-test-clock.js`: both education-series integration files now use `TZ=UTC` and a fixed clock (`2026-10-13T10:00:00.000Z`) so host timezone/date cannot mask the defect or age future fixtures.
- `utcDateAfter()` in the series suite now derives relative fixtures from the controlled clock instead of the old `2026-10-03` anchor.

## Verification

- `npm run check:runtime`: PASS (Node 22.23.1 / npm 10.9.8).
- `npm run check:syntax`: PASS (1563 JavaScript files).
- `npm run check:timeline-protected-surface`: PASS (6 protected blocks; no manifest change).
- `node --check` on all changed JavaScript: PASS.
- `node --test --test-name-pattern 'past' tests/booking-create-durability.test.js`: PASS, 4/4 selected non-education past-time tests.
- UTC fixed-clock smoke: PASS; controlled time and offset-free UTC parse matched the regression setup.
- `node --test tests/static-doc-guard.test.js`: PASS, 5/5 after moving this handoff under `docs/`.
- `npm ci --no-audit --no-fund`: PASS in the task worktree; installed exact lockfile dependencies without changing package metadata or lockfile.
- Repository `npm test`: PASS on Node 22.23.1 / npm 10.9.8 with exact lockfile dependencies.
- `node --test tests/upload-dependency-regression.test.js`: PASS, 3/3 on locked `multer 2.4.0`; the earlier timeout came from reusing the main checkout's stale `multer 2.2.0` module.
- Education-series Express → PostgreSQL integration regression: initially BLOCKED_FIXTURE before the temporary target was provisioned; this was superseded by the 2026-10-13 final local recheck below, which passed 18/18 series and 11/11 acceptance cases.
- `git diff --check`: PASS.

## Task sequence

| Task | Scope | Status |
| --- | --- | --- |
| EDU-TIME-01 | Kyiv-time validation for lesson-series writes; focused regression and disposable PostgreSQL proof | PASS. Actual-app → Express → disposable PostgreSQL regression passed under `TZ=UTC`; single lesson and series both reject the same past Kyiv time, and SQL confirms zero inserted occurrences. |
| EDU-TIME-02 | Replace aging fixed future dates in education-series tests with stable fixtures | PASS. Both education-series integration files use the fixed `2026-10-13T10:00:00.000Z` clock; relative fixtures no longer age against the old `2026-10-03` hard-coded date. |
| EDU-TIME-03 | Recheck date-only, DST, series boundaries, and business isolation after the timezone fix | PASS. 18/18 series integration cases, 11/11 actual-app/API acceptance cases, and all 13 date-runner checks passed on disposable PostgreSQL; see evidence below. |
| EDU-TIME-04 | Final local acceptance and release readiness; release only with a fresh user authorization envelope | HOLD_REMOTE_DRIFT. The authorized controller passed its local baseline and prepared 0.82.84, but push was rejected after a parallel release advanced production. The scoped mandatory-inventory supplement is isolated on the verified remote base; a fresh envelope is required after convergence. |

### EDU-TIME-03 coverage review

- Date-only browser suite: `tests/browser/education-ready-date-browser.js` contains visible date edit, save/reload/card/API/SQL, persisted-column preservation, and old/new Today/day/week projection checks. Its runner `tests/integration/run-education-ready-design.js` requires the owned fixed DB at loopback `127.0.0.1:55469`; it compares a demo manifest before/after and writes only the locked fixed DB. It initially could not run without that target; the final isolated run and cleanup proof are recorded below.
- DST and month/year boundaries: `tests/integration/education-series.integration.test.js` and `tests/integration/education-series.integration-acceptance.test.js` contain daily/weekly/biweekly boundary and Kyiv DST checks. The education-series runner now fixes app and test clocks in UTC.
- Business isolation: the integration suite has same-teacher independent business writes and business-scoped conflict-lock tests with SQL assertions.
- No missing scenario source was found in this review. This is a source-coverage finding only; it does not upgrade any scenario to PASS.

## Next action

Use the prepared controller manifest for one bounded release authorization, then exact-SHA CI, the manual Railway helper, and read-only live QA. Local acceptance is not CI, live-site, or physical-device evidence.

## Initial availability recheck — 2026-10-13 (before RAM-cluster provisioning)

- `npm run check:runtime`: PASS, Node 22.23.1 / npm 10.9.8.
- `npm run check:syntax`: PASS, 1563 files.
- `npm run check:timeline-protected-surface`: PASS, six protected blocks unchanged.
- Fixed-clock smoke under `TZ=UTC`: PASS; injected time is `2026-10-13T10:00:00.000Z`, an offset-free local parse stays UTC, and `Europe/Kyiv` resolves to 13:00.
- `node --test tests/static-doc-guard.test.js`: the sandboxed loopback fetch failed; rerun with permitted local loopback execution passed all 5/5 checks. This was a test-environment restriction, not a product failure.
- At this point neither `TEST_DATABASE_URL` nor `DATABASE_URL` was present; no PostgreSQL listener was observed and Docker Desktop engine was unavailable. This was the reason for provisioning the temporary RAM-backed cluster described in the final recheck below; it is no longer the current test status.
- Main checkout is still untouched. No commit, push, deploy, schema, permission, dependency, or lockfile changes.

### Final local recheck — 2026-10-13

- Runtime and full repository baseline: `npm test` PASS on Node 22.23.1 / npm 10.9.8. This is a broad repository gate and is not counted as an education journey.
- `node scripts/run-isolated-postgres-tests.js education-series`: PASS, `education-series.integration.test.js` 18/18 and `education-series.integration-acceptance.test.js` 11/11. The latter includes four Chromium actual-app browser cases; the other seven cases exercise API/SQL contracts. The new past-time regression ran against a real temporary PostgreSQL cluster with the Express process forced to UTC.
- `node tests/integration/run-education-ready-date.js` with stage `08B`, suite `date`: PASS, 13/13 checks (11 date scenarios plus fixture and page-error checks). Visible edit → save → reload → canonical card → API/SQL matched; duration, teacher, group, cabinet, time, and other persisted fields stayed stable; Today/day/week moved from the old date to the new date; month/year and Kyiv DST dates were preserved; conflict returned 409 without partial changes; adjacent slot, invalid date, slow save/double-submit, 503 draft/retry, selected series member, mobile 390px, and create-date override all passed.
- The date runner used a dedicated PostgreSQL 16 cluster in RAM at `/dev/shm/edu-time-close-20261013-attempt1`, loopback port `55469`. Its `eventgenix_education_ready_fixture_test` was reset and verified empty after cleanup. Its `eventgenix_education_ready_manual` control DB was seeded with synthetic data in the same disposable cluster only; the before/after manifest hash remained `617e689e9faf28f645a33623513f2a5ed3c006fa0dcb56d8e83dd8df8e9f2cc3`, with 39 owned bookings. The user's retained manual database and main checkout were not opened or modified.
- The task-owned cluster was stopped after the run and port `55469` has no listener. WSL's existing `16/main` cluster reported `online` on port `5432` when checked with `pg_lsclusters`; it was not queried or changed. No production endpoint or business record was written.
- Playwright `1.64.0` was invoked through the existing temporary `npx` cache; no project dependency, `package.json`, or lockfile changed. Browser engine: Chromium. Physical-device verification remains outside this workstream and is not inferred from emulation.
- Screenshots and the exact date-run evidence are under `output/education-ready/08B/regressions/date/attempt-2026-10-13T17-15-00-983Z/`; the machine-readable result is `verification.json`, and runner-level cleanup/preservation proof is `output/education-ready/08B/regressions/fixed-runner-result.json`. The screenshot captured a transient `Перепідключення...` WebSocket toast from the local browser session; it did not fail the date assertions or produce page errors, and this time-validation task did not investigate transport recovery.
- Hashes at this recheck:
  - `routes/bookings.js`: `4FBB85602394F6A0BA89EC7C99922529326C17926ABFD8884E537FA9982FFD9A`
  - `scripts/run-isolated-postgres-tests.js`: `9825E17A3006B96F920E97997C88FFC74FBCA0517B0C817C7C5A57575146F9B8`
  - `tests/integration/education-series.integration.test.js`: `5647EE0199E6DB708653DD8B9B658F2786F30AFCBE980C4B873BF56B883D776E`
  - `tests/integration/education-series.integration-acceptance.test.js`: `0DF58F1A771F7E80DEB563719E8622C2C535A0032F3C5E72C2E63D51CE5E9DED`
  - `tests/helpers/education-series-test-clock.js`: `07A7BDDF79826170B30EC5D2D71B816E447136AB73EBC144CF317D3446797982`
  - `tests/browser/education-ready-date-browser.js`: `11AAB4EEF3081D230E19C2D9A2DCC4E64F1ADDBDD13296ED7F3386BA31F18930`
  - `tests/integration/run-education-ready-design.js`: `ADD22B3582A9D3291582FF2F642DEAD9A80313591C41771AF4CC4F7DBD99D338`
- `git diff --check`: PASS. No product scope, protected booking contract, migration, or dependency changes. No commit, push, or deploy.

## Release preflight blocker resolution — 2026-10-13T17:47Z

- The earlier Git worktree error and live-domain DNS failure were caused by sandbox access restrictions. The same read-only commands passed with the required task-worktree and network access. No Git configuration, DNS settings, Railway settings, or source code was changed to resolve this environment problem.
- The unlinked task worktree does not need a Railway link. Read-only `railway status --project bc28b46c-d4bc-491c-893a-d8401c633668 --environment production --json` confirms project `fortunate-appreciation`, environment `production`, service `8223324090` (`3fb62d4c-2dc2-4701-8e2b-09ce16e188ee`), and domain `8223324090-production.up.railway.app`.
- Latest Railway deployment `5bc994e6-753c-4945-889a-b5c9111c4e2a` is `SUCCESS`, created at `2026-10-13T16:06:27.588Z`. Its release message identifies `v0.82.81`, `db948525`, and `codex/eventgenix-production`.
- Fresh live `/api/version` and remote production HEAD both confirm exact SHA `db9485256740bf1d1b8f90ddda4e5b2069ead03e`, branch `codex/eventgenix-production`, and live version `0.82.81`. Live deployment metadata is complete, manifest-based, and has no warnings.
- Railway reports null source repo/image for this manually uploaded service. The effective release branch is established by the complete live release manifest, matching remote ref, and deployment message; this is not represented as a configured GitHub auto-deploy source. No source or auto-deploy setting was changed.
- Proposed release: next free patch `0.82.82`, label `Заняття: київський час серій`. No active worktree marker in the current `0.82.x` release line or remote tag reserves it. An old Hermes worktree with a historical `28.0.0` marker is unrelated. The helper rejects a different-SHA deployment using the existing `0.82.81` version.
- Scope: the reviewed past-time fix, deterministic isolated tests, this handoff, and signed Ukrainian release notes. No migrations, production seed, business writes, schema/auth/permissions/protected-manifest changes, or dependency changes are included. The previous exact production SHA is the binary rollback reference.
- Browser computer-use was unavailable in the earlier attempt because the UI helper could not confidently establish the current URL. The resolved HTTP/CLI preflight does not claim browser or physical-device QA. Physical device checks remain separately blocked.
- Product and generated version/cache/changelog commits will remain separate. Controller `prepare` and `execute --dry-run` are local/read-only preparation; push/deploy execution remains pending the one exact controller authorization.
## CI attempt 1 baseline and scoped harness correction

- Authorized block: `EG-20261013T174949Z-d3e53319`; initial functional SHA `d3e53319132dbc543acf9837c4d50472853ffc5c`.
- Attempt 1 release SHA: `b9a368a6d7bb7ce29c0b9e53945b17d0fb8089d9`, version `0.82.82`. Exact-SHA CI run `38443850468` failed in `Education series (chromium)`. The controller exited nonzero before any deploy; production remained at `0.82.81` / `db9485256740bf1d1b8f90ddda4e5b2069ead03e`.
- Preserved evidence: `output/education-time-close/ci-attempt-1-result.json` and the original CI artifact under `output/education-time-close/ci-attempt-1-series/ci-series-chromium/attempt-2026-10-13T18-05-47-747Z-series-chromium-3db7c0/`. Its record remains `FAIL_OR_BLOCKED`, exit 1; captured TAP is 16 PASS / 2 FAIL / 0 skipped.
- Symptom: the new UTC past-time assertion received real time `2026-10-13T18:05:54.137Z` instead of controlled `2026-10-13T10:00:00.000Z`; the held-report assertion also returned 0 instead of 1.
- Expected: both direct `education-series` and CI `education-close-series` invocation paths use the same UTC app/test clock. The CI series report must use that clock, without retaining a different report-only date.
- Root cause before edit: the clock condition in `runSuite` matched only `suiteMode=education-series` plus direct integration filenames. `run-education-close-ci.js` supplies `suiteMode=education-close-series` and the PostgreSQL wrapper, with the actual contract file in `EDU_CLOSE_PG_FILE`. Its inherited `education-ready-report-clock.js` preload separately pins reports to 2026-10-03. Thus the wrapper tests had real Date, and their held fixtures were future relative to the report-only clock.
- Narrow implementation target: recognize this exact existing wrapper/contract combination in `scripts/run-isolated-postgres-tests.js`; remove only the conflicting report-clock preload for this series path, preserve loopback/network isolation, and apply the existing UTC fixed-clock helper to app and test subprocesses. No workflow, permission, product semantics, dependency, or protected manifest changes.
- Verification plan: run the exact CI series command locally against a new owned RAM-backed PostgreSQL cluster, with source-bound attempt evidence and zero skips; repeat the direct series runner; then commit the scoped correction and use the same unexpired block's next controller attempt. The generated release patch advances to 0.82.83; no failed release is relabeled as accepted.
### Scoped CI correction recheck

- Exact CI invocation `node tests/integration/run-education-close-ci.js series chromium`: PASS, 18/18 API/SQL checks, zero skipped. Current source-bound record: `output/education-ready/time-close-ci-retry-2/attempt-2026-10-13T18-17-34-857Z-series-chromium-f55962/record.json`; its validated proof hash is `7d4959ab298f13b7b216ab230a6950a68dc49bf617720fb5997a0617de256adb`.
- The preceding local attempt `attempt-2026-10-13T18-17-11-089Z-series-chromium-d9c49c` was stopped by the required disposable-reset confirmation guard before schema reset. It remains separately recorded as blocked; it is not counted as a successful run.
- Direct `node scripts/run-isolated-postgres-tests.js education-series`: PASS, 18/18 series checks and 11/11 acceptance cases, zero skipped. Captured output: `output/education-time-close/local-direct-series-retry-2.log`. The acceptance suite includes actual-app Chromium and the Park canonical-card scenario; it is not represented as eleven UI journeys.
- These checks used only the newly owned PostgreSQL 16 RAM cluster `/dev/shm/edu-time-close-20261013-attempt2`, loopback port 55469, database `eventgenix_education_ready_fixture_test`. Its disposable public tables were verified empty and the exact cluster was stopped. The retained manual dataset and existing main PostgreSQL cluster were not opened or modified.
- The correction changes only the already approved isolated-runner file and this handoff. The same bounded production block has two remaining release attempts, with its original expiry unchanged. Attempt 2 will run a fresh full baseline and exact-SHA CI before any deploy.
## Resume audit — 2026-10-14

- Exact release SHA `d968d1b619f6d20673063c962aa5177733c9bf78` / version `0.82.83` has green push CI run `38446914114`: 23/23 jobs PASS, including all 15 education jobs and the previously failed series wrapper.
- The controller process/session ended before deployment. Its redacted log ends in CI watch output; no completed-release SHA is recorded. Fresh live and Railway read-only checks confirm the previous `0.82.81` / `db9485256740bf1d1b8f90ddda4e5b2069ead03e`, deployment `5bc994e6-753c-4945-889a-b5c9111c4e2a`, still SUCCESS. No release controller/deploy-helper Node process remained active. No new Railway upload is claimed.
- Old block `EG-20261013T174949Z-d3e53319` expired at `2026-10-13T23:49:49.073Z` (02:49 Kyiv on October 14). It must not be extended or reused. Production readiness/schema health are OK with zero pending data migrations. Remote production still equals the owned `d968d1b619f6d20673063c962aa5177733c9bf78`; no foreign drift was observed.
- Completed CI result: `output/education-time-close/ci-attempt-2-result.json`. Passing series artifact: `output/education-time-close/ci-attempt-2-series-proof/ci-series-chromium/attempt-2026-10-13T18-28-18-255Z-series-chromium-f31735/`; its proof hash is `b13eabb0255b792f919f45dcad5e04d459b4140349e21a3541b3c82ad35d4cd1`, log hash `86ef111770d8bd7d8930af27de2f421a2168629573d5181ac316869e3349e03f`.

### Mandatory inventory gap — before edit

- Symptom: captured TAP executes 18 series cases with zero failures/skips, but the proof contract lists only 17 mandatory IDs; the new UTC past-time regression is absent from `tests/helpers/education-close-contracts.json`.
- Expected: fresh evidence is rejected if that exact new regression is not executed, in addition to the existing mandatory cases.
- Root cause: the regression was added to the integration source without updating the explicit series scenario inventory. The current successful execution is real; the future fail-closed requirement is incomplete.
- Narrow fix: add the exact existing regression title to the series `requiredIds`. No product, workflow, dependency, schema, permission, or protected changes.
- Verification: parse the preserved passing TAP with the new contract (18 required cases), remove only the new regression's successful TAP line and require rejection, then run the existing evidence-validator tests. The old 17-ID record remains historical and is not relabeled as fresh evidence after the harness change.
- A renewed production envelope will sign the prepared descendant and the next free patch `0.82.84`; the canonical controller will obtain fresh exact-SHA CI after version/cache changes, then perform the manual helper deploy and read-only QA. Physical-device checks remain BLOCKED_DEVICE.
### Resume preparation verification

- Tightened series inventory: the real captured CI TAP passes all 18 required IDs, including the UTC past-time regression. Removing only that regression's successful TAP line is rejected by the parser.
- `node --test tests/education-close-evidence.test.js tests/static-doc-guard.test.js`: PASS, 27 checks, zero skips. These are validator/documentation checks, not education UI journeys.
- Runtime/product source is unchanged from the green 0.82.83 SHA; the mandatory inventory and handoff are the only new local changes. Fresh final-source CI remains required after the canonical controller generates the next patch's release artifacts.
## Authorized release collision — 2026-10-14

- Block `EG-20261014T072408Z-88337973` was explicitly approved. The controller completed `npm test`, generated version/cache/changelog commit `65f8236a2105f80a4e2a019895a7b2bdfcf8b219` (`0.82.84`), then exited 1 when Git rejected its push as non-fast-forward. It did not reach CI or Railway upload.
- During that baseline, a separate active controller for block `EG-20261014T072844Z-d968d1b6` advanced remote production to `bff441a4c6ee37db77bdcbaf88f086d2831dfab2`. The latter is a release-artifact-only descendant of `d968d1b619f6d20673063c962aa5177733c9bf78`; it includes the Kyiv runtime fix and wrapper clock correction, but retains the old 17-ID mandatory series inventory.
- Live at the collision audit still reported `0.82.81` / `db9485256740bf1d1b8f90ddda4e5b2069ead03e`. Parallel CI `38530709841` was in progress; its result and deployment must be checked separately. A pending parallel CI run is not accepted deployment proof.
- No force-push, reset, cleanup, controller interruption, settings change, or production business write was used. The main dirty checkout and both original controller logs/manifest histories are preserved.
- Current continuation worktree: `C:/Users/Plotva/.codex/worktrees/education-time-close-finalize-20261014/EventGenix`; branch `codex/education-time-close-finalize-20261014`; base `bff441a4c6ee37db77bdcbaf88f086d2831dfab2`. Commit `8ff5391b5` cherry-picks only the mandatory UTC inventory and its evidence notes. Functional source remains identical to the parallel candidate.
- Next step: finish the local negative inventory checks, observe the active parallel controller read-only until terminal state, re-confirm live/remote/target, then prepare one fresh bounded release block for the supplement. The old block explicitly stops on external production drift and will not be reused.
- Physical devices remain `BLOCKED_DEVICE` under the owner's explicit deferral. Chromium/WebKit results cannot change that status.

### Scoped supplement local verification

- `npm ci --no-audit --no-fund`: PASS with the exact lockfile; no dependency or lockfile changes.
- Node 22.23.1 / npm 10.9.8 and `npm run check:version`: PASS for current base 0.82.84.
- `node --test tests/education-close-evidence.test.js tests/static-doc-guard.test.js`: 27/27 PASS, zero skips. These are validator/documentation checks, not journeys.
- Fresh parallel-CI series TAP has all 18 real PASS cases, but its historical record still lists 17 mandatory checks. The tightened parser accepts the complete TAP and rejects removal of the successful UTC case. Probe: `output/education-time-close/mandatory-utc-finalize-probe.json`. This probe is not a substitute for the supplement's future exact-SHA CI.
- Supplement release notes now describe only the strengthened verification inventory. No runtime source, protected manifest, SQL, auth, permission, dependency, or workflow file differs from the remote base.
