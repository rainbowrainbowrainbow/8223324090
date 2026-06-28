# Event Genix System Optimization Detailed Tasks

Date: 2026-06-28
Status: executable task pack
Source documents:

- `docs/SYSTEM_OPTIMIZATION_ANALYSIS_AND_TASKS_2026-06-27.md`
- `docs/SYSTEM_OPTIMIZATION_EXECUTION_MAP_2026-06-28.md`

Production impact: yes for implementation tasks. This file is docs-only.

## How To Use This Pack

Run tasks in order unless a task explicitly says it is discovery-only and can
be parallelized. Each task should be a separate PR or a clearly separated
commit group. Do not mix optimization work with unrelated release/UI changes.

Every task starts with:

```bash
git status --short --branch
```

If a target file is dirty, inspect its diff before editing:

```bash
git diff -- <file>
git diff --cached -- <file>
```

Use canonical runtime for representative checks:

```bash
npx -y -p node@22 -p npm@10 -c "<command>"
```

Protected areas requiring explicit confirmation before implementation:

- database schema, migrations, production data, upload migration;
- auth, sessions, roles, permissions, query-token policy;
- CI/CD, deploy, Railway, hosting, production branch policy;
- environment variables, secrets, webhooks, external provider settings;
- new dependencies, dependency upgrades, lockfile changes;
- destructive cleanup, file deletion, force push, rollback, production smoke
  with real credentials.

## Current Task Board

| Order | Task | Type | Status | Protected |
| --- | --- | --- | --- | --- |
| 01 | Runtime and release docs alignment | docs/process | partly done in current worktree | no |
| 02 | PostgreSQL CI discovery report | discovery | next | yes before CI edit |
| 03 | Browser, visual, accessibility discovery report | discovery | planned | yes before CI/dependency edit |
| 04 | Upload durability discovery report | discovery | planned | yes before DB/storage edit |
| 05 | Scheduler behavior discovery report | discovery | planned | yes before cadence/side-effect edit |
| 06 | `checkBookingPushReminders` behavior hardening | implementation | planned after Task 05 | yes if cadence changes |
| 07 | Public API exception audit | security docs | planned | yes before auth/webhook edit |
| 08 | Observability discovery and no-dependency design | discovery/design | planned | yes before endpoint/dependency/env edit |
| 09 | DB startup reduction discovery | discovery | planned | yes before migration/startup edit |
| 10 | Frontend session and CSP discovery | discovery | planned | yes before auth/session/CSP edit |
| 11 | Assistant product context completion discovery | discovery | planned | yes before provider/domain-model edit |
| 12 | Frontend decomposition first slice | implementation | planned later | maybe |
| 13 | Backend decomposition first slice | implementation | planned later | maybe |
| 14 | Final push and deploy gate | release/deploy | owner-run last | yes |

## Task 01 - Runtime And Release Docs Alignment

Goal:

- Make the active docs match the real runtime and release source of truth.
- Prevent agents from trusting Node 24/npm 11 checks.
- Prevent old `0.60.x` release-train instructions from driving new releases.

Current state:

- `docs/LOCAL_RUNTIME_SETUP.md` exists.
- `README.md` and `AGENTS.md` now document the `npx -y -p node@22 -p npm@10`
  fallback.
- `README.md` and `AGENTS.md` now say the active release train follows
  `package.json`, currently `0.77.x`.

Files:

- `README.md`
- `AGENTS.md`
- `docs/LOCAL_RUNTIME_SETUP.md`
- `package.json`
- `scripts/check-runtime.js`
- `scripts/current-version.js`
- `scripts/version-sync.js`

Implementation steps:

1. Confirm `package.json` current version:

   ```bash
   npx -y -p node@22 -p npm@10 -c "npm run version:current"
   ```

2. Search active docs for stale release-train wording:

   ```bash
   rg -n "Active release train|0\\.60\\.x|0\\.60\\." README.md AGENTS.md docs
   ```

3. Do not edit historical changelog entries or archived docs unless they claim
   to be active operating authority.
4. Keep this task docs-only unless the worktree is clean enough to isolate
   `package.json` script changes.
5. Do not run `npm run version:sync` unless a release-marker fix is explicitly
   intended.

Acceptance:

- Active docs point to `package.json` as release source of truth.
- Active docs do not say `0.60.x` is current.
- Runtime docs show a Node 22/npm 10 fallback command.
- No CI, DB, auth, deploy, env, dependency, or lockfile changes.

Verification:

```bash
npx -y -p node@22 -p npm@10 -c "npm run check:runtime"
npx -y -p node@22 -p npm@10 -c "npm run version:current"
npx -y -p node@22 -p npm@10 -c "npm run check:version"
npx -y -p node@22 -p npm@10 -c "npm run check:syntax"
git diff --check
```

Rollback:

- Revert `README.md`, `AGENTS.md`, and `docs/LOCAL_RUNTIME_SETUP.md` only.

## Task 02 - PostgreSQL CI Discovery Report

Goal:

- Produce a concrete plan for a PostgreSQL-backed CI job without editing CI yet.
- Identify the smallest stable DB-backed suite that should run in CI later.

Output file:

- `docs/POSTGRES_CI_DISCOVERY_2026-06-28.md`

Files to inspect:

- `.github/workflows/ci.yml`
- `README.md`
- `tests/api.test.js`
- `tests/route-smoke.test.js`
- `tests/*integration*`
- `db/index.js`
- `db/migrate.js`
- `db/migrations/`
- `utils/loadLocalEnv.js`
- `scripts/check-migrations.js`
- `scripts/release-gate.js`
- `package.json`

Discovery questions:

- Which tests require a live server?
- Which tests require PostgreSQL?
- Which tests require `TEST_USER`, `TEST_PASS`, `JWT_SECRET`, or other env?
- Which tests mutate data heavily?
- Which tests can run against an isolated ephemeral DB?
- Which tests are too flaky or too broad for the first CI job?
- How long does each candidate command take locally?
- What migrations or startup hooks are required before API tests can run?

Implementation steps:

1. Read `.github/workflows/ci.yml` and confirm current fast-baseline job.
2. Read `tests/api.test.js` and document required env and app URL.
3. Search tests for `TEST_URL`, `TEST_USER`, `TEST_PASS`, `DATABASE_URL`,
   `PGHOST`, and `loadLocalEnv`.
4. Create the discovery report with a candidate first CI suite.
5. Do not edit `.github/workflows/ci.yml` in this task.

Suggested report structure:

- current CI baseline;
- local DB test prerequisites;
- candidate test commands;
- env matrix;
- data mutation risk;
- first CI job proposal;
- rejected tests and why;
- open questions;
- implementation task for CI edit.

Commands:

```bash
rg -n "TEST_URL|TEST_USER|TEST_PASS|DATABASE_URL|PGHOST|loadLocalEnv|listen\\(|localhost:3000" tests scripts db routes README.md
npx -y -p node@22 -p npm@10 -c "npm test"
```

Optional only with isolated local app/DB:

```bash
npx -y -p node@22 -p npm@10 -c "npm run test:api"
npx -y -p node@22 -p npm@10 -c "npm run test:integration"
```

Acceptance:

- Report names exact candidate tests and why.
- Report names exact env vars and app startup assumptions.
- Report states what is out of scope for first CI DB job.
- No production DB URL or production credentials are used.
- No CI file is edited.

Verification:

```bash
git diff --check -- docs/POSTGRES_CI_DISCOVERY_2026-06-28.md
npx -y -p node@22 -p npm@10 -c "npm run check:syntax"
```

Rollback:

- Delete the discovery file.

## Task 03 - Browser, Visual, And Accessibility Discovery Report

Goal:

- Decide which browser checks are stable enough to become a separate gate.
- Avoid adding flaky CI before evidence exists.

Output file:

- `docs/BROWSER_VISUAL_A11Y_DISCOVERY_2026-06-28.md`

Files to inspect:

- `package.json`
- `tests/browser/`
- `tests/ui-check.js`
- `scripts/audit-booking-summary-layout.js`
- `booking-summary.html`
- `invite.html`
- `index.html`
- `js/timeline.js`
- `css/booking-summary.css`
- `.github/workflows/ci.yml`

Implementation steps:

1. List all existing browser scripts from `package.json`.
2. Inspect each `tests/browser/*` script for server requirements, credentials,
   screenshots, and flakiness risks.
3. Run public/auth-light scripts first.
4. Record runtime duration and failure mode for each script.
5. Recommend first browser gate order.
6. Do not edit CI in this task.

Commands:

```bash
rg -n "test:browser|playwright|screenshot|viewport|console" package.json tests/browser scripts
npx -y -p node@22 -p npm@10 -c "npm run test:browser:booking-summary"
npx -y -p node@22 -p npm@10 -c "npm run test:browser:invite"
npx -y -p node@22 -p npm@10 -c "npm run test:ui"
```

Optional after first two are stable:

```bash
npx -y -p node@22 -p npm@10 -c "npm run test:browser:timeline"
npx -y -p node@22 -p npm@10 -c "npm run test:browser:event-cards"
```

Missing tests to propose:

- console-error check;
- mobile and desktop viewport checks;
- nonblank screenshot/canvas assertion where relevant;
- keyboard/focus smoke for modal-heavy surfaces;
- basic accessibility smoke for public pages.

Acceptance:

- Report ranks browser scripts by stability and value.
- Report names exact CI candidate commands.
- Report lists what would be added later, not immediately.
- No CI, dependency, or app behavior changes.

Verification:

```bash
git diff --check -- docs/BROWSER_VISUAL_A11Y_DISCOVERY_2026-06-28.md
npx -y -p node@22 -p npm@10 -c "npm run check:syntax"
```

Rollback:

- Delete the discovery file.

## Task 04 - Upload Durability Discovery Report

Goal:

- Prove current upload durability risk with file and DB evidence.
- Choose the safest first storage implementation slice.

Output file:

- `docs/UPLOAD_DURABILITY_DISCOVERY_2026-06-28.md`

Files to inspect:

- `config/storageSurface.js`
- `docs/STORAGE_SURFACE.md`
- `server.js`
- `.gitignore`
- `services/chatUploadStorage.js`
- `services/audioStorage.js`
- `services/imageStorage.js`
- `services/profileAvatarStorage.js`
- `services/designStorage.js`
- `routes/chat.js`
- `routes/music.js`
- `routes/catalogs.js`
- `routes/products.js`
- `db/migrations/`
- `tests/chat-upload-storage.test.js`
- `tests/chat-upload-route.test.js`
- `tests/audio-storage.test.js`
- `tests/image-storage.test.js`
- `tests/profile-avatar-storage.test.js`
- `tests/design-storage.test.js`

Discovery questions:

- How many local files exist in each upload directory?
- Which tables reference each public upload path?
- Which files are orphaned?
- Which DB rows reference missing files?
- Which services already implement Postgres blob primary storage?
- Which path should migrate first: chat, sounds, or catalog images?
- What is the storage choice: Postgres blobs, remote bucket, or Railway volume?

Implementation steps:

1. Inventory local directories without deleting anything.
2. Inspect storage services and tests.
3. Map public URLs to DB references.
4. Document legacy fallback requirements.
5. Recommend one first implementation path.
6. Do not add migrations, tables, buckets, env vars, or file migration logic in
   this discovery task.

Safe inventory commands:

```bash
Get-ChildItem -Recurse uploads\\chat -File -ErrorAction SilentlyContinue | Measure-Object
Get-ChildItem -Recurse uploads\\sounds -File -ErrorAction SilentlyContinue | Measure-Object
Get-ChildItem -Recurse uploads\\catalog-images -File -ErrorAction SilentlyContinue | Measure-Object
npx -y -p node@22 -p npm@10 -c "npm run check:storage-surface"
```

Focused tests:

```bash
npx -y -p node@22 -p npm@10 -c "node --test tests/chat-upload-storage.test.js tests/chat-upload-route.test.js"
npx -y -p node@22 -p npm@10 -c "node --test tests/audio-storage.test.js tests/image-storage.test.js tests/profile-avatar-storage.test.js tests/design-storage.test.js"
```

Acceptance:

- Report names counts, owners, known DB references, unknowns, and first slice.
- No files are deleted or migrated.
- No DB schema or env changes.

Verification:

```bash
git diff --check -- docs/UPLOAD_DURABILITY_DISCOVERY_2026-06-28.md
npx -y -p node@22 -p npm@10 -c "npm run check:storage-surface"
```

Rollback:

- Delete the discovery file.

## Task 05 - Scheduler Behavior Discovery Report

Goal:

- Rank scheduler jobs by runtime side-effect risk.
- Select the first job to harden with direct tests.

Output file:

- `docs/SCHEDULER_BEHAVIOR_DISCOVERY_2026-06-28.md`

Files to inspect:

- `server.js`
- `config/schedulerSurface.js`
- `docs/SCHEDULER_SURFACE.md`
- `services/scheduler.js`
- `services/schedulerGuard.js`
- `services/telegram.js`
- `services/eventBus.js`
- `services/taskLifecycle.js`
- scheduler-related tests in `tests/`

Discovery ranking dimensions:

- user-visible side effects;
- duplicate-message risk;
- DB mutation risk;
- retry/idempotency complexity;
- raw interval vs guarded job;
- existing direct behavior tests;
- owner module and rollback difficulty.

Implementation steps:

1. List all static-only scheduler jobs.
2. Inspect `checkBookingPushReminders` first.
3. Inspect high-risk raw intervals: `telegramRetryQueue`,
   `eventBusProcessOutbox`, `taskLifecycleStartup`, `taskLifecycleDaily`.
4. Create a ranked table.
5. Recommend the first behavior-hardening implementation task.
6. Do not change scheduler timing or code in this task.

Commands:

```bash
npx -y -p node@22 -p npm@10 -c "npm run check:scheduler-surface"
rg -n "checkBookingPushReminders|guardScheduler|setInterval|setTimeout|STATIC_ONLY_SCHEDULER_JOBS" server.js services config tests
```

Focused tests to run for existing anchors:

```bash
npx -y -p node@22 -p npm@10 -c "node --test tests/scheduled-chat-dispatch.test.js tests/reply-escalation.test.js tests/customer-birthday-tags.test.js"
```

Acceptance:

- Report identifies first implementation job.
- Report explains why that job is first.
- Report names missing direct behavior tests.
- No runtime scheduler behavior changes.

Verification:

```bash
git diff --check -- docs/SCHEDULER_BEHAVIOR_DISCOVERY_2026-06-28.md
npx -y -p node@22 -p npm@10 -c "npm run check:scheduler-surface"
```

Rollback:

- Delete the discovery file.

## Task 06 - `checkBookingPushReminders` Behavior Hardening

Goal:

- Add direct behavior coverage for `checkBookingPushReminders`.
- Fix dedup/cadence only if discovery proves current behavior is wrong and
  product/ops confirms the intended notification cadence.

Prerequisite:

- Task 05 completed.

Files to inspect:

- `services/scheduler.js`
- `services/schedulerGuard.js`
- `config/schedulerSurface.js`
- `docs/SCHEDULER_SURFACE.md`
- new or existing scheduler tests in `tests/`

Implementation steps:

1. Read current function and side effects.
2. Build fake DB/service test harness.
3. Test no duplicate notification on repeated ticks.
4. Test expected due reminder selection.
5. Test controlled error path.
6. If cadence remains daily, document why.
7. If cadence changes, get confirmation first, then update code, manifest,
   docs, and tests.
8. Remove `checkBookingPushReminders` from `STATIC_ONLY_SCHEDULER_JOBS` only
   after direct behavior tests exist.

Expected test file:

- `tests/booking-push-reminders-scheduler.test.js` or a similarly focused name.

Verification:

```bash
npx -y -p node@22 -p npm@10 -c "node --test tests/booking-push-reminders-scheduler.test.js"
npx -y -p node@22 -p npm@10 -c "npm run check:scheduler-surface"
npx -y -p node@22 -p npm@10 -c "npm test"
git diff --check
```

Acceptance:

- Direct behavior test exists.
- Duplicate run does not duplicate side effects.
- Scheduler manifest and docs match code.
- Static-only list shrinks only if direct coverage is real.

Rollback:

- Revert test/code/docs/config changes for this one job.

## Task 07 - Public API Exception Audit

Goal:

- Audit every public API and query-token exception for real guard quality.

Output file:

- `docs/PUBLIC_API_EXCEPTION_AUDIT_2026-06-28.md`

Files to inspect:

- `config/authBoundary.js`
- `middleware/apiAuthBoundary.js`
- `middleware/auth.js`
- `docs/AUTH_BOUNDARY.md`
- `routes/auth.js`
- `routes/telegram.js`
- `routes/report-bot.js`
- `routes/hermes.js`
- `routes/personal-accounts.js`
- `routes/kleshnya.js`
- `routes/music.js`
- `routes/demo.js`
- `routes/packages.js`
- `routes/status.js`
- `routes/leads.js`
- `routes/landing.js`
- `tests/auth-boundary.test.js`
- `tests/route-smoke.test.js`

Report row fields:

- method/path/prefix;
- owner;
- data exposed;
- data mutated;
- guard mechanism;
- rate limit;
- focused tests;
- risk rating;
- recommendation;
- implementation task if needed.

Commands:

```bash
npx -y -p node@22 -p npm@10 -c "npm run check:auth-boundary"
npx -y -p node@22 -p npm@10 -c "node --test tests/auth-boundary.test.js tests/route-smoke.test.js"
```

Acceptance:

- No endpoint is marked unknown.
- High-risk endpoints get concrete follow-up tasks.
- Docs and config remain aligned.
- No route behavior changes in the audit task.

Verification:

```bash
git diff --check -- docs/PUBLIC_API_EXCEPTION_AUDIT_2026-06-28.md
npx -y -p node@22 -p npm@10 -c "npm run check:auth-boundary"
```

Rollback:

- Delete the audit file.

## Task 08 - Observability Discovery And No-Dependency Design

Goal:

- Define the smallest observability improvement that does not require new
  dependencies or external services.

Output file:

- `docs/OBSERVABILITY_DISCOVERY_2026-06-28.md`

Files to inspect:

- `utils/logger.js`
- `middleware/requestId.js`
- `middleware/errorResponseMetadata.js`
- `routes/settings.js`
- `services/schedulerGuard.js`
- `scripts/live-smoke.js`
- `scripts/live-version-smoke.js`
- `scripts/release-gate.js`
- `docs/RELEASE_RELIABILITY.md`
- `config/authBoundary.js`
- `config/apiSurface.js`

Discovery questions:

- What do `/api/health`, `/api/ready`, and `/api/health/deep` expose?
- Where is `requestId` created and returned?
- Where are scheduler executions stored?
- Which provider readiness flags can be shown without secrets?
- What can operators diagnose today without logs?
- Should the first implementation be an authenticated admin-only
  `/api/ops/summary` or just better live-smoke output?

Commands:

```bash
rg -n "requestId|health|ready|health/deep|scheduler_executions|live-smoke|version-smoke" utils middleware routes services scripts docs
npx -y -p node@22 -p npm@10 -c "npm run check:auth-boundary"
npx -y -p node@22 -p npm@10 -c "npm run check:api-surface"
```

Acceptance:

- Report recommends one no-new-dependency implementation slice.
- Report explicitly blocks Sentry/OpenTelemetry/Prometheus until approved.
- No endpoint, env, dependency, or CI change in this task.

Verification:

```bash
git diff --check -- docs/OBSERVABILITY_DISCOVERY_2026-06-28.md
npx -y -p node@22 -p npm@10 -c "npm run check:api-surface"
```

Rollback:

- Delete the discovery file.

## Task 09 - DB Startup Reduction Discovery

Goal:

- Identify one safe startup shim candidate to remove or migrate later.

Output file:

- `docs/DB_STARTUP_REDUCTION_DISCOVERY_2026-06-28.md`

Files to inspect:

- `db/index.js`
- `db/migrate.js`
- `db/migrations/`
- `config/dbStartupSurface.js`
- `docs/DB_STARTUP_SURFACE.md`
- `DB_MIGRATION_GOVERNANCE.md`
- `scripts/check-db-startup-surface.js`
- `scripts/check-migrations.js`

Discovery questions:

- Which startup tables already have durable migrations?
- Which columns/indexes are redundant with migrations?
- Which shims are needed for old production DB compatibility?
- Which data hooks are seed/bootstrap and which are cleanup?
- Which single index or compatibility column is safest first?

Commands:

```bash
npx -y -p node@22 -p npm@10 -c "npm run check:db-startup-surface"
npx -y -p node@22 -p npm@10 -c "npm run check:migrations"
rg -n "CREATE TABLE IF NOT EXISTS|ADD COLUMN IF NOT EXISTS|CREATE INDEX IF NOT EXISTS|STARTUP_SCHEMA|STARTUP_DATA" db config scripts docs
```

Acceptance:

- Report names a safe first candidate or says no candidate is safe yet.
- No migrations or startup code changes.
- No destructive data operations.

Verification:

```bash
git diff --check -- docs/DB_STARTUP_REDUCTION_DISCOVERY_2026-06-28.md
npx -y -p node@22 -p npm@10 -c "npm run check:db-startup-surface"
npx -y -p node@22 -p npm@10 -c "npm run check:migrations"
```

Rollback:

- Delete the discovery file.

## Task 10 - Frontend Session And CSP Discovery

Goal:

- Map current token storage and CSP debt before any auth/security change.

Output file:

- `docs/FRONTEND_SESSION_SECURITY_DISCOVERY_2026-06-28.md`

Files to inspect:

- `middleware/auth.js`
- `middleware/security.js`
- `middleware/apiAuthBoundary.js`
- `routes/auth.js`
- `js/auth.js`
- `js/api.js`
- root HTML pages with inline scripts
- `tests/auth-frontend-session.test.js`
- `tests/auth-account-lifecycle.test.js`

Discovery questions:

- Where are access and refresh tokens written?
- Where are they read?
- Which pages require inline scripts/styles?
- Which endpoints issue refresh tokens?
- Is httpOnly refresh cookie feasible without breaking current flows?
- What CSP tightening can happen incrementally?

Commands:

```bash
rg -n "localStorage|sessionStorage|pzp_token|pzp_refresh_token|refresh|Content-Security-Policy|unsafe-inline|setHeader\\(" middleware routes js *.html tests
npx -y -p node@22 -p npm@10 -c "node --test tests/auth-frontend-session.test.js tests/auth-account-lifecycle.test.js"
npx -y -p node@22 -p npm@10 -c "npm run check:auth-boundary"
```

Acceptance:

- Report maps token read/write paths.
- Report lists inline-script blockers.
- Report proposes a staged migration path.
- No auth/session/CSP behavior changes.

Verification:

```bash
git diff --check -- docs/FRONTEND_SESSION_SECURITY_DISCOVERY_2026-06-28.md
npx -y -p node@22 -p npm@10 -c "npm run check:auth-boundary"
```

Rollback:

- Delete the discovery file.

## Task 11 - Assistant Product Context Completion Discovery

Goal:

- Stop assistant work from inventing unclear deals/call concepts.
- Map which page context is actually passed to assistant APIs.

Output file:

- `docs/ASSISTANT_CONTEXT_COMPLETION_DISCOVERY_2026-06-28.md`

Files to inspect:

- `services/aiProductContext.js`
- `services/dashboardAssistant.js`
- `routes/crm-assistant.js`
- `routes/dashboard-assistant.js`
- `prompts/crm-assistant-system.md`
- `js/assistant-rail.js`
- `js/crm-feature-registry.js`
- `docs/ai-context/`
- selected `js/*-page.js`

Discovery questions:

- Which pages send assistant context today?
- Which payload fields describe current page, tab, entity, visible rows, or
  selected record?
- What should "deal" map to in Event Genix?
- Do calls exist as first-class records or only communication entries?
- What docs/runtime context is missing first?

Commands:

```bash
rg -n "crm-assistant|dashboard-assistant|recentState|signals|featureLocator|visible|context|communication_log|deal|call" services routes js docs prompts tests
npx -y -p node@22 -p npm@10 -c "node --test tests/dashboard-assistant.test.js tests/assistant-feature-locator.test.js tests/assistant-output-format.test.js"
```

Acceptance:

- Report answers "deal" and "call" mapping with repo evidence.
- Report identifies one first page adapter or docs-context improvement.
- No provider/env/domain-model changes.

Verification:

```bash
git diff --check -- docs/ASSISTANT_CONTEXT_COMPLETION_DISCOVERY_2026-06-28.md
npx -y -p node@22 -p npm@10 -c "node --test tests/dashboard-assistant.test.js tests/assistant-feature-locator.test.js tests/assistant-output-format.test.js"
```

Rollback:

- Delete the discovery file.

## Task 12 - Frontend Decomposition First Slice

Goal:

- Extract one stable frontend domain boundary without changing user behavior.

Prerequisites:

- Task 03 browser discovery completed.
- Existing dirty UI/release changes are either committed or deliberately
  isolated.

Recommended first candidates:

1. Booking drawer state/render helpers from `js/booking.js`.
2. HR payroll/KPI helpers from `js/hr-page.js`.
3. Chat Omni mode helpers from `js/chat-page.js`.
4. Dashboard widget recovery helpers from `js/dashboard-page.js`.

Files to inspect:

- `tests/ui-check.js`
- target JS file;
- related existing helper files;
- root HTML script order;
- `sw.js` if app shell references change.

Implementation steps:

1. Pick exactly one slice.
2. Add or confirm static global/export tests before moving code.
3. Move code with minimal formatting changes.
4. Preserve public globals and script order.
5. Update HTML script tags only if needed.
6. Run focused UI tests before full baseline.

Verification:

```bash
npx -y -p node@22 -p npm@10 -c "npm run check:syntax"
npx -y -p node@22 -p npm@10 -c "npm run test:ui"
npx -y -p node@22 -p npm@10 -c "npm test"
git diff --check
```

Acceptance:

- One domain boundary is smaller.
- Behavior and public globals are unchanged.
- No broad reformat.
- Browser smoke for touched page passes if available.

Rollback:

- Revert the one extraction slice.

## Task 13 - Backend Decomposition First Slice

Goal:

- Move one narrow backend business helper out of a large route file while
  preserving route contracts.

Prerequisites:

- Dirty release/worktree state is isolated.
- Focused test target is chosen before code movement.

Recommended first candidates:

- booking resource identity helper;
- booking payload normalization helper;
- HR role-assignment helper;
- HR candidate/vacancy lifecycle helper.

Files to inspect:

- `routes/hr.js`
- `routes/bookings.js`
- existing HR services:
  `services/hrPayrollPeriod.js`, `services/hrOnboarding.js`,
  `services/hrStaffDocuments.js`, `services/hrStaffResources.js`,
  `services/hrPayrollSchemes.js`
- related tests in `tests/`
- `config/apiSurface.js`
- `docs/API_SURFACE.md`

Implementation steps:

1. Choose one helper boundary.
2. Add focused fake-DB/service tests first.
3. Move pure business logic to service.
4. Keep permission middleware and response shaping in the route.
5. Keep endpoint paths and response shape unchanged.
6. Avoid schema changes.

Verification:

```bash
npx -y -p node@22 -p npm@10 -c "node --test tests/<focused-domain-test>.test.js"
npx -y -p node@22 -p npm@10 -c "npm run check:api-surface"
npx -y -p node@22 -p npm@10 -c "npm test"
git diff --check
```

Acceptance:

- Route response shape is unchanged.
- New service test covers edge cases.
- API surface guard remains green.
- No unrelated route cleanup.

Rollback:

- Revert the one service extraction.

## Task 14 - Final Push And Deploy Gate

Goal:

- Push and deploy only after all selected implementation tasks have passed
  local and CI gates.

Executor:

- Owner/operator. Codex must not run this task unless explicitly asked and the
  target branch/environment is confirmed.

Protected confirmation:

- Required. This task touches GitHub remote and production deploy flow.

Prerequisites:

- Worktree contains only intended changes.
- No unrelated dirty files are included.
- `package.json` version and `eventGenix.releaseLabel` match intended release.
- `CHANGELOG.md` and `index.html` "Що нового" are updated for user-visible
  changes.
- `npm run check:version` is green.
- Full baseline is green on Node 22/npm 10.
- CI is expected to run on `codex/timeline-leads-hardening`.
- Railway production target branch is confirmed as
  `codex/timeline-leads-hardening` unless owner says otherwise.

Pre-push checklist:

```bash
git status --short --branch
npx -y -p node@22 -p npm@10 -c "npm run version:current"
npx -y -p node@22 -p npm@10 -c "npm run check:version"
npx -y -p node@22 -p npm@10 -c "npm test"
git diff --check
```

Review staged changes:

```bash
git diff --cached --stat
git diff --cached -- README.md AGENTS.md docs
git diff --cached -- package.json package-lock.json index.html CHANGELOG.md sw.js
```

Commit:

```bash
git add <intended-files-only>
git commit -m "Document system optimization execution tasks"
```

Push:

```bash
git push origin codex/timeline-leads-hardening
```

Post-push:

1. Wait for GitHub Actions fast baseline.
2. Do not deploy manually if CI is red.
3. If Railway auto-deploys from the branch, watch the Railway build logs.
4. Confirm Node 22 is used in build logs.
5. Confirm app starts cleanly.

Post-deploy smoke:

```bash
npm run smoke:live -- https://<live-crm-host>
npm run version:smoke -- https://<live-crm-host>
```

If authenticated smoke is required:

```bash
LIVE_SMOKE_TOKEN=<jwt> npm run smoke:live -- https://<live-crm-host>
```

or:

```bash
LIVE_SMOKE_USER=<login> LIVE_SMOKE_PASS=<password> npm run smoke:live -- https://<live-crm-host>
```

Never commit or print real credentials.

Acceptance:

- Intended files only are committed.
- Push succeeds.
- CI passes.
- Railway deploy uses Node 22.
- `/api/version` and visible login version match `package.json`.
- `/api/ready` and `/api/health/deep` are healthy.
- Any failed live smoke blocks release closure.

Rollback plan:

- If CI fails, do not deploy; fix or revert before merge/redeploy.
- If deploy fails during startup, inspect Railway logs first.
- If live smoke fails and fix is not obvious within 10-15 minutes, prefer
  rollback/revert on the deploy branch over blind production patching.
- Do not push to historical `deployed` branch unless owner confirms Railway was
  reconfigured to that branch.

Final release note template:

```text
Root cause / decision:
Files changed:
Verification:
CI:
Deploy:
Live smoke:
Remaining risks:
Next action:
```
