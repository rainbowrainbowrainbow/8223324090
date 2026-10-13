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
| EDU-TIME-04 | Final local acceptance and release readiness; release only with a fresh user authorization envelope | Local verification PASS. Release preflight blockers are resolved; the product commit and signed controller manifest are being prepared. Production push/deploy require the exact bounded controller authorization. |

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