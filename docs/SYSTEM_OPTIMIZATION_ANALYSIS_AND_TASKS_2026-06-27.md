# Event Genix System Optimization Analysis And Task Pack

Date: 2026-06-27
Status: planning artifact, ready for task breakdown
Owner: Codex / engineering
Scope: production hardening, verification quality, architecture cleanup
Production impact: yes for most implementation tasks below

## Why This File Exists

This file turns the system audit into executable tasks. Some tasks are too large
to start directly. For those, the first task is a discovery and quality pass
that produces deeper evidence, sharper scope, and safer implementation tickets.

The current system is not broken. The fast baseline passed on the canonical
runtime:

- Node 22.23.1 / npm 10.9.8 through `npx -p node@22 -p npm@10`.
- `npm test` passed.
- Unit/test baseline reported 1158 tests/checks passing.
- UI smoke reported 1078 checks passing.

The missing pieces are production-grade layers around a large working monolith:
live DB verification, browser/a11y coverage, upload durability, scheduler
behavior tests, observability, security hardening, and a controlled cleanup path
for large modules.

## Current Evidence Snapshot

From local audit:

- Runtime mismatch in the default shell: Node 24.13.0 / npm 11.6.2.
- Required project runtime: Node 22.x / npm 10.x.
- CI runs `npm test` only on Node 22/npm 10.
- CI does not run PostgreSQL-backed API or integration tests.
- CI does not run browser automation, accessibility checks, production deploy
  proof, or live Railway health checks.
- There is no style lint, TypeScript typecheck, or build pipeline.
- API surface: 84 route files, 85 route mounts, no unmounted route files.
- Static surface: 39 root HTML pages, 3 landing pages, 8 legacy redirects.
- CSS surface: 81 CSS files.
- DB startup surface: 42 startup tables, 52 startup columns, 90 startup indexes,
  1 startup function, 1 trigger, 10 startup data hooks.
- Scheduler surface: 47 guarded jobs and 9 raw intervals/starters.
- Scheduler static-only debt: 45 scheduler items.
- Storage surface: 5 local upload paths, 0 remote buckets.
- Local-filesystem-primary binary paths still exist for chat, sounds, and
  catalog images.
- Public API exceptions: 34.
- Query-token auth exceptions: 2.
- Service Worker API cache allowlist: 2 public GET endpoints.
- Offline mutation replay: disabled.
- Large files include `index.html`, `js/booking.js`, `js/dashboard-page.js`,
  `js/chat-page.js`, `js/hr-page.js`, `routes/hr.js`, and `routes/bookings.js`.

## Task Execution Rules

Follow these rules for every task below:

- Start with `git status --short --branch`.
- Read dirty diffs before touching a dirty file.
- Do not overwrite existing user changes.
- Use Node 22/npm 10 for representative verification.
- Do not change database schema, auth/session model, CI/deploy, env vars,
  secrets, external integrations, dependencies, or production settings without
  explicit confirmation.
- For implementation tasks with protected areas, produce a focused plan first.
- Add focused tests before broad refactors.
- Run the smallest relevant checks first, then `npm test` when risk justifies.
- Do not claim live or browser verification unless it was actually run.

## Task 00 - Optimization Discovery And Task Quality Pass

Priority: P0
Type: analysis first, no product behavior changes
Production impact: no direct runtime impact
Why first: several implementation tasks below touch protected or high-risk
areas. This task makes each one concrete before code changes.

### Goal

Create a stronger task map from repo evidence, not assumptions. The output
should let implementation agents pick one task and know exactly:

- which files to inspect;
- which existing tests prove current behavior;
- which missing tests must be added;
- what is in scope;
- what is explicitly out of scope;
- where protected confirmation is required;
- what acceptance means.

### Inputs To Read

Required files:

- `AGENTS.md`
- `README.md`
- `package.json`
- `.github/workflows/ci.yml`
- `docs/CLEANUP_REGISTER.md`
- `docs/STORAGE_SURFACE.md`
- `docs/SCHEDULER_SURFACE.md`
- `docs/DB_STARTUP_SURFACE.md`
- `docs/STATIC_SURFACE.md`
- `docs/AUTH_BOUNDARY.md`
- `docs/SERVICE_WORKER_CACHE_POLICY.md`
- `docs/RELEASE_RELIABILITY.md`
- `docs/ai-context/unresolved-questions.md`
- `config/storageSurface.js`
- `config/schedulerSurface.js`
- `config/dbStartupSurface.js`
- `config/authBoundary.js`
- `config/staticSurface.js`
- `config/serviceWorkerPolicy.js`

Commands:

```bash
git status --short --branch
npx -y -p node@22 -p npm@10 -c "npm run check:runtime"
npx -y -p node@22 -p npm@10 -c "npm run cleanup:inventory"
npx -y -p node@22 -p npm@10 -c "npm test"
```

### Required Output

Create or update a follow-up file:

```text
docs/SYSTEM_OPTIMIZATION_EXECUTION_MAP_YYYY-MM-DD.md
```

It must contain:

- ranked task list with P0/P1/P2/P3;
- implementation order;
- files to inspect per task;
- tests to run per task;
- missing tests to create per task;
- protected confirmations needed per task;
- likely blast radius;
- rollback strategy;
- one recommended first implementation task.

### Acceptance Criteria

- No code or behavior changes.
- Every recommended implementation task points to concrete repo files.
- Every protected area is marked explicitly.
- Every task has focused verification commands.
- The first implementation slice is small enough for one safe PR.

### Verification

```bash
git diff --check
npx -y -p node@22 -p npm@10 -c "npm run check:syntax"
```

## Task 01 - Local Runtime Alignment

Priority: P0
Type: developer environment hardening
Production impact: indirect, improves verification trust
Protected areas: none if only docs/scripts are changed; dependency/tooling
changes require confirmation

### Problem

The repo requires Node 22.x and npm 10.x, but the current shell reported:

- Node 24.13.0
- npm 11.6.2

Direct local `npm run check:runtime` fails. Agents can still use:

```bash
npx -y -p node@22 -p npm@10 -c "npm test"
```

But this is slower and easy to forget.

### Goal

Make it hard to accidentally trust Node 24/npm 11 verification.

### Scope Options

Option A - documentation only:

- Update `README.md` and `AGENTS.md` with the exact local workaround.
- Add a short `docs/LOCAL_RUNTIME_SETUP.md`.

Option B - script wrapper:

- Add `npm run verify:node22` that uses `npx -y -p node@22 -p npm@10 -c "npm test"`.
- Add `npm run check:runtime:node22` similarly.

Option C - tool pin:

- Add Volta or fnm configuration.
- This is a tooling policy change and needs confirmation.

Recommended first slice: Option B, because it is practical and avoids changing
global developer tooling.

### Files To Inspect

- `package.json`
- `scripts/check-runtime.js`
- `README.md`
- `AGENTS.md`

### Implementation Steps

1. Confirm current scripts and runtime pins.
2. Add wrapper scripts only if approved.
3. Document when to use wrapper scripts.
4. Keep existing `npm test` unchanged.
5. Do not change Node engine pins.

### Acceptance Criteria

- There is a repo-approved command that runs the fast baseline under Node 22/npm
  10 even when the host shell is wrong.
- Docs explain that host Node 24 results are not representative.
- Existing CI remains unchanged unless explicitly approved.

### Verification

```bash
npm run check:runtime
npx -y -p node@22 -p npm@10 -c "npm run check:runtime"
npx -y -p node@22 -p npm@10 -c "npm test"
```

If the host runtime remains wrong, the first command may fail and must be
reported as expected.

## Task 02 - PostgreSQL CI And Live API Verification

Priority: P0
Type: test infrastructure
Production impact: yes
Protected areas: CI/CD settings, database test setup; requires explicit
confirmation before editing `.github/workflows/ci.yml`

### Problem

CI runs only `npm test`. The README explicitly says route smoke is shallow and
does not exercise full PostgreSQL-backed route behavior.

This leaves risk in:

- bookings;
- lines/resources;
- leads;
- finance;
- HR;
- uploads metadata;
- migrations against a real database;
- startup schema parity.

### Goal

Add a separate CI job that starts PostgreSQL and runs the most valuable
DB-backed tests without making the fast baseline too slow.

### Discovery Required Before Implementation

Before editing CI, produce a mini report:

- Which tests require a running app and DB?
- Which tests require credentials?
- Which tests mutate data heavily?
- Which tests are stable enough for CI now?
- What env vars are required?
- How long does each candidate test take locally?

### Candidate Commands

```bash
npm run test:api
npm run test:integration
node --test tests/api.test.js
```

Do not add all integration tests blindly. Start with a stable subset.

### Files To Inspect

- `.github/workflows/ci.yml`
- `tests/api.test.js`
- `tests/*integration*`
- `README.md`
- `db/index.js`
- `db/migrate.js`
- `db/migrations/`
- `utils/loadLocalEnv.js`
- `scripts/check-migrations.js`

### Implementation Plan

1. Create discovery report first.
2. Choose minimal DB-backed suite.
3. Add PostgreSQL service to CI.
4. Run migrations in CI test DB.
5. Start app on local CI port if required.
6. Run selected tests.
7. Keep fast baseline job separate.
8. Add timeout and clear failure logs.

### Acceptance Criteria

- Fast baseline CI stays as is.
- New DB CI job runs on Node 22/npm 10.
- DB job fails on migration/startup/API contract issues.
- CI output clearly separates fast baseline failures from DB-backed failures.
- No production DB URL or secret is used.

### Verification

Local:

```bash
npx -y -p node@22 -p npm@10 -c "npm test"
```

CI validation:

- Push to non-production branch or open draft PR.
- Confirm both CI jobs run.
- Confirm DB job uses ephemeral local PostgreSQL only.

### Risks

- Test flakiness if API tests assume live credentials.
- Longer CI time.
- Hidden reliance on local `.env`.

### Stop Conditions

- Tests require production credentials.
- Tests depend on real customer data.
- Migrations are destructive in test setup without isolation.

## Task 03 - Browser, Visual, And Accessibility Gate

Priority: P0/P1
Type: frontend verification
Production impact: yes
Protected areas: CI changes require confirmation

### Problem

UI smoke is static/jsdom-oriented. It does not fully prove:

- browser rendering;
- responsive layout;
- keyboard focus;
- modal behavior;
- visual overlap;
- canvas/nonblank states;
- accessibility basics;
- real asset loading.

The project has browser scripts:

- `test:browser:event-cards`
- `test:browser:booking-summary`
- `test:browser:invite`
- `test:browser:timeline`

They are not part of CI baseline.

### Goal

Create a small, stable browser gate for the highest-risk UI surfaces.

### First Slice

Start with two surfaces:

1. `/booking-summary.html`
2. `/invite`

Then add:

3. timeline browser smoke
4. event cards visual smoke

### Files To Inspect

- `tests/browser/`
- `scripts/audit-booking-summary-layout.js`
- `package.json`
- `.github/workflows/ci.yml`
- `tests/ui-check.js`
- pages involved in browser scripts

### Implementation Steps

1. Run each browser script locally under Node 22.
2. Record runtime duration and flakiness.
3. Pick stable scripts for CI.
4. Add screenshots only as artifacts when failing or when useful.
5. Add mobile and desktop viewport checks for the selected surfaces.
6. Add simple a11y checks only where stable.

### Acceptance Criteria

- Browser gate catches blank page, missing critical assets, layout overlap, and
  obvious console errors for selected pages.
- It does not require production credentials for public pages.
- For authenticated pages, it uses safe local test credentials or a controlled
  app fixture.
- CI job is optional/separate at first if runtime is too long.

### Verification

```bash
npx -y -p node@22 -p npm@10 -c "npm run test:browser:booking-summary"
npx -y -p node@22 -p npm@10 -c "npm run test:browser:invite"
npx -y -p node@22 -p npm@10 -c "npm run test:ui"
```

## Task 04 - Upload Durability For Chat, Sounds, And Catalog Images

Priority: P0/P1
Type: storage architecture
Production impact: yes
Protected areas: storage provider, DB schema, migrations, env vars; requires
explicit confirmation before implementation

### Problem

The storage surface reports 0 remote buckets. These paths still use local
filesystem as primary binary source:

- `/uploads/chat`
- `/uploads/sounds`
- `/uploads/catalog-images`

Postgres stores metadata, not all binary content. On Railway without persistent
volume, files can disappear across redeploys/restarts/new instances.

Profile avatars and designs already have Postgres-blob-primary behavior for new
writes, with local fallback.

### Goal

Make all user/business-critical generated or uploaded files durable.

### Discovery Required Before Implementation

Produce:

```text
docs/UPLOAD_DURABILITY_DISCOVERY_YYYY-MM-DD.md
```

It must answer:

- How many files exist under each upload directory?
- Which DB rows reference each file?
- Which files are orphaned?
- Which files are missing but referenced?
- Which paths are read by public static mount only?
- Which services already know how to write Postgres blobs?
- Which storage option is preferred: Postgres blobs, remote buckets, or Railway
  volume?

### Files To Inspect

- `config/storageSurface.js`
- `docs/STORAGE_SURFACE.md`
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

### Recommended Implementation Strategy

Use Postgres blob storage first for consistency with profile avatars and
designs, unless explicit product/ops decision prefers remote storage.

Phase A:

- Add discovery report only.
- No schema changes.

Phase B:

- Add one binary table for the smallest/highest-value path, likely catalog
  images or sounds.
- New writes store binary in Postgres.
- Public URL stays compatible.
- Read path checks Postgres first, local legacy fallback second.

Phase C:

- Migrate remaining paths one by one.

### Acceptance Criteria

- New writes do not depend on local disk for durability.
- Existing legacy URLs keep working when local files exist.
- Missing legacy files return controlled errors.
- Storage docs and config reflect the new fallback policy.
- Tests cover write, read, delete/archive, missing file, and metadata.

### Verification

```bash
npx -y -p node@22 -p npm@10 -c "npm run check:storage-surface"
npx -y -p node@22 -p npm@10 -c "node --test tests/image-storage.test.js"
npx -y -p node@22 -p npm@10 -c "node --test tests/audio-storage.test.js"
npx -y -p node@22 -p npm@10 -c "node --test tests/chat-upload-storage.test.js tests/chat-upload-route.test.js"
npx -y -p node@22 -p npm@10 -c "npm test"
```

### Stop Conditions

- Need to change production storage provider/env without approval.
- Migration requires moving or deleting real files without inventory.
- DB size impact is unknown for large audio/image files.

## Task 05 - Scheduler Side-Effect Coverage And Dedup Hardening

Priority: P0/P1
Type: background jobs reliability
Production impact: yes
Protected areas: scheduler side effects, Telegram, notifications

### Problem

Scheduler surface has 47 guarded jobs and 9 raw intervals/starters. 45 items
are static-only coverage debt. Static guards prove the job is listed, not that
it behaves correctly.

Known visible risk:

- `checkBookingPushReminders` looks minute-based but uses guard default
  daily dedup.

### Goal

Turn high-risk scheduler jobs from static-only debt into behavior-tested,
idempotent jobs.

### Discovery Required Before Implementation

Create:

```text
docs/SCHEDULER_BEHAVIOR_DISCOVERY_YYYY-MM-DD.md
```

It must rank jobs by:

- customer-visible side effects;
- duplicate-message risk;
- data mutation risk;
- retry/idempotency complexity;
- existing tests;
- owner module.

### First Implementation Slice

Start with one of:

1. `checkBookingPushReminders`
2. `telegramRetryQueue`
3. `eventBusProcessOutbox`
4. `taskLifecycleStartup` / `taskLifecycleDaily`
5. `checkExpiredChatMessages`

Recommended first slice: `checkBookingPushReminders`, because the documented
dedup mismatch is explicit.

### Files To Inspect

- `server.js`
- `config/schedulerSurface.js`
- `docs/SCHEDULER_SURFACE.md`
- `services/scheduler.js`
- `services/schedulerGuard.js`
- `services/telegram.js`
- `services/eventBus.js`
- `services/taskLifecycle.js`
- scheduler-related tests

### Implementation Steps

For each selected job:

1. Document current trigger, dedup, and side effects.
2. Add fake DB/service tests for idempotency.
3. If behavior is wrong, fix the smallest possible code path.
4. Add or update manifest tests.
5. Remove job from `STATIC_ONLY_SCHEDULER_JOBS` only when direct behavior tests
   exist.

### Acceptance Criteria

- Selected job has direct tests.
- Duplicate scheduler run does not duplicate side effects.
- Error path is observable and does not corrupt state.
- `check:scheduler-surface` remains green.
- Static-only list shrinks by at least one item per implementation slice.

### Verification

```bash
npx -y -p node@22 -p npm@10 -c "npm run check:scheduler-surface"
npx -y -p node@22 -p npm@10 -c "node --test tests/<new-scheduler-test>.test.js"
npx -y -p node@22 -p npm@10 -c "npm test"
```

### Stop Conditions

- Behavior requires real Telegram credentials.
- Side effect cannot be simulated without a larger service abstraction.
- Fix would change notification cadence without product/ops approval.

## Task 06 - DB Startup Surface Reduction

Priority: P1
Type: database architecture cleanup
Production impact: yes
Protected areas: DB schema, migrations, startup data hooks; requires explicit
confirmation before implementation

### Problem

Startup still owns:

- 42 compatibility tables;
- 52 compatibility columns;
- 90 startup indexes;
- 10 startup data hooks;
- one startup data delete hook.

The guard prevents drift, but fresh DB parity still depends on both startup
code and migrations.

### Goal

Move one small startup responsibility at a time into durable migrations, then
remove the equivalent startup shim only after proving a fresh DB path.

### Discovery Required Before Implementation

Create:

```text
docs/DB_STARTUP_REDUCTION_DISCOVERY_YYYY-MM-DD.md
```

It must identify:

- which startup tables already have durable migrations;
- which columns/indexes are redundant with migrations;
- which shims are still needed for older production DBs;
- which data hooks are seed/bootstrap versus cleanup;
- a safe first removal candidate.

### Recommended First Slice

Do not start with tables. Start with one redundant startup index or one clearly
covered compatibility column.

### Files To Inspect

- `db/index.js`
- `db/migrate.js`
- `db/migrations/`
- `config/dbStartupSurface.js`
- `docs/DB_STARTUP_SURFACE.md`
- `DB_MIGRATION_GOVERNANCE.md`
- `scripts/check-db-startup-surface.js`
- `scripts/check-migrations.js`

### Acceptance Criteria

- No startup shim is removed unless an equivalent migration exists.
- Fresh DB path is tested.
- Existing DB compatibility remains safe.
- Docs/config are updated in the same change.

### Verification

```bash
npx -y -p node@22 -p npm@10 -c "npm run check:db-startup-surface"
npx -y -p node@22 -p npm@10 -c "npm run check:migrations"
npx -y -p node@22 -p npm@10 -c "npm test"
```

If a fresh PostgreSQL test DB is available:

```bash
node db/migrate.js
npm run test:api
```

### Stop Conditions

- Need to delete production data.
- Equivalent migration cannot be proven.
- Startup hook has unclear production dependency.

## Task 07 - Frontend Session And CSP Hardening

Priority: P1
Type: security hardening
Production impact: yes
Protected areas: authentication/session model, security headers; requires
explicit confirmation before implementation

### Problem

Current frontend session flow uses `localStorage` for tokens such as
`pzp_token` and `pzp_refresh_token`. Security headers include CSP, but allow
`unsafe-inline` scripts/styles due to legacy static HTML patterns.

This is not a current test failure, but it is a production security ceiling:
XSS can reach tokens stored in browser storage.

### Goal

Reduce impact of XSS and move toward stronger browser session boundaries.

### Discovery Required Before Implementation

Create:

```text
docs/FRONTEND_SESSION_SECURITY_DISCOVERY_YYYY-MM-DD.md
```

It must answer:

- where tokens are written/read;
- which pages depend on inline scripts;
- which routes issue refresh tokens;
- whether httpOnly refresh-cookie is feasible without breaking mobile/public
  flows;
- what CSP changes can be made incrementally;
- what tests already cover auth frontend session.

### Files To Inspect

- `middleware/auth.js`
- `middleware/security.js`
- `middleware/apiAuthBoundary.js`
- `routes/auth.js`
- `js/auth.js`
- `js/api.js`
- `tests/auth-frontend-session.test.js`
- `tests/auth-account-lifecycle.test.js`
- root HTML pages with inline scripts

### Implementation Options

Option A - CSP cleanup first:

- Keep token model.
- Reduce inline script/style where easiest.
- Add tests around security headers.

Option B - httpOnly refresh cookie:

- Access token may remain memory/local short-term.
- Refresh token moves to httpOnly secure sameSite cookie.
- Requires auth API changes and frontend refresh flow changes.

Option C - hybrid staged model:

- Add cookie support while preserving legacy storage.
- Gradually migrate pages.

Recommended first slice: discovery, then a narrow security-header test and
cookie feasibility plan. Do not rewrite auth in one pass.

### Acceptance Criteria

- Existing login/refresh/logout tests remain green.
- No user-facing auth regression.
- Security docs explain current model and target model.
- Any CSP tightening is backed by browser/static tests.

### Verification

```bash
npx -y -p node@22 -p npm@10 -c "node --test tests/auth-frontend-session.test.js tests/auth-account-lifecycle.test.js"
npx -y -p node@22 -p npm@10 -c "npm run check:auth-boundary"
npx -y -p node@22 -p npm@10 -c "npm test"
```

### Stop Conditions

- Requires changing production session behavior without approval.
- Requires invalidating all user sessions.
- CSP change breaks inline-heavy pages without migration path.

## Task 08 - Observability And Production Diagnostics

Priority: P1
Type: operations reliability
Production impact: yes
Protected areas: new dependencies, external service, env vars; requires
confirmation

### Problem

The app has structured logging and request IDs, but no confirmed APM/error
tracking/metrics stack. Production incidents still depend heavily on logs and
manual smoke.

### Goal

Add a minimal operational visibility layer:

- error capture;
- request latency/error rate;
- scheduler job health;
- DB readiness and migration status visibility;
- external provider readiness without secrets;
- live smoke artifacts.

### Discovery Required Before Implementation

Create:

```text
docs/OBSERVABILITY_DISCOVERY_YYYY-MM-DD.md
```

It must answer:

- what Railway already exposes;
- what logs include today;
- what `/api/health`, `/api/ready`, `/api/health/deep` return;
- where request IDs are attached;
- where scheduler executions are stored;
- whether adding Sentry/OpenTelemetry/Prometheus is acceptable.

### Files To Inspect

- `utils/logger.js`
- `middleware/requestId.js`
- `middleware/errorResponseMetadata.js`
- `routes/settings.js`
- `services/schedulerGuard.js`
- `docs/RELEASE_RELIABILITY.md`
- `scripts/live-smoke.js`
- `scripts/live-version-smoke.js`

### Implementation Options

Option A - no new dependency:

- Add `/api/ops/summary` for authenticated admin diagnostics.
- Add structured logs around key failures.
- Add scheduler execution summary.

Option B - external error tracking:

- Add Sentry or OpenTelemetry.
- Requires dependency/env approval.

Recommended first slice: Option A.

### Acceptance Criteria

- Operators can see app version, DB readiness, scheduler recent failures, and
  provider configuration state without secrets.
- Error responses include request IDs.
- No secrets are printed.
- Existing public health endpoints stay public and safe.

### Verification

```bash
npx -y -p node@22 -p npm@10 -c "npm run check:auth-boundary"
npx -y -p node@22 -p npm@10 -c "npm run check:api-surface"
npx -y -p node@22 -p npm@10 -c "npm test"
```

## Task 09 - Large Frontend Module Decomposition

Priority: P2
Type: maintainability
Production impact: yes if behavior changes
Protected areas: none unless new dependencies/build tooling are introduced

### Problem

Large frontend modules increase regression risk:

- `index.html` about 14.9k lines.
- `js/booking.js` about 11.5k lines.
- `js/dashboard-page.js`, `js/chat-page.js`, `js/hr-page.js`,
  `js/profile-page.js` are large.

The repo has no build pipeline, TypeScript, or lint. Refactors must preserve
static loading order and global functions.

### Goal

Split only stable domain boundaries into smaller files without changing public
behavior.

### First Candidate Slices

1. Booking drawer state/render helpers from `js/booking.js`.
2. HR payroll/KPI UI helpers from `js/hr-page.js`.
3. Chat Omni mode UI helpers from `js/chat-page.js`.
4. Dashboard widget recovery/assistant helpers from `js/dashboard-page.js`.

Do not split by line count alone.

### Files To Inspect

- `tests/ui-check.js`
- `js/booking.js`
- `js/booking-drawer-state.js`
- `js/booking-banquet-selector.js`
- `js/booking-save-path.js`
- `js/hr-page.js`
- `js/chat-page.js`
- `js/dashboard-page.js`
- root HTML script loading order

### Implementation Steps

1. Pick one domain slice.
2. Add or expand static contract tests before moving code.
3. Extract without changing names expected by HTML/global handlers.
4. Update HTML/script references if needed.
5. Update Service Worker/cache-bust/version references only through approved
   version sync flow when release-relevant.

### Acceptance Criteria

- `npm run test:ui` catches missing globals.
- Browser smoke for touched page passes.
- No broad formatting.
- No mixed unrelated UI changes.

### Verification

```bash
npx -y -p node@22 -p npm@10 -c "npm run check:syntax"
npx -y -p node@22 -p npm@10 -c "npm run test:ui"
npx -y -p node@22 -p npm@10 -c "npm test"
```

## Task 10 - Backend Domain Decomposition

Priority: P2
Type: maintainability and testability
Production impact: yes if behavior changes
Protected areas: DB writes, route contracts, scheduler side effects depending
on slice

### Problem

Some backend route files remain large and own too much orchestration:

- `routes/hr.js`
- `routes/bookings.js`
- other domain-heavy route files

The repo already has a good pattern: extract helpers/services while keeping
routes, permissions, public URLs, and response shapes stable.

### Goal

Move narrow business logic slices from route files into services with focused
tests.

### Candidate Slices

Bookings:

- resource identity resolution;
- drawer save payload normalization;
- booking visibility/filter explanation;
- banquet/linking helper boundaries.

HR:

- candidate/vacancy lifecycle helpers;
- payroll adjustment helpers;
- KPI computation helpers;
- account-center mapping helpers.

### Files To Inspect

- `routes/hr.js`
- `routes/bookings.js`
- `services/hrPayrollPeriod.js`
- `services/hrOnboarding.js`
- `services/hrStaffDocuments.js`
- `services/hrStaffResources.js`
- `services/hrPayrollSchemes.js`
- related tests in `tests/`

### Acceptance Criteria

- Route response shape remains unchanged.
- Permission middleware remains in route layer.
- Service owns pure business logic and side-effect helpers.
- Focused service tests cover edge cases.
- No schema changes unless separately approved.

### Verification

```bash
npx -y -p node@22 -p npm@10 -c "node --test tests/<focused-domain-test>.test.js"
npx -y -p node@22 -p npm@10 -c "npm run check:api-surface"
npx -y -p node@22 -p npm@10 -c "npm test"
```

## Task 11 - Assistant Product Context Completion

Priority: P2
Type: AI assistant quality
Production impact: yes if assistant runtime changes
Protected areas: external AI providers/env if changed

### Problem

The AI product context docs explicitly list unresolved areas:

- calls are not clearly first-class with statuses/forms;
- no confirmed canonical `deals` table;
- unclear whether every page sends tab/entity/visible rows to assistant;
- component-level inventory is incomplete.

### Goal

Make assistant answers more grounded and reduce fake precision.

### Discovery Required Before Implementation

Create:

```text
docs/ASSISTANT_CONTEXT_COMPLETION_DISCOVERY_YYYY-MM-DD.md
```

It must answer:

- which pages send assistant context today;
- what adapter data each page includes;
- what entity IDs are available;
- what "deal" should map to in Event Genix;
- whether calls need a product model or just communication log mapping;
- what missing context produces wrong assistant answers.

### Files To Inspect

- `services/aiProductContext.js`
- `services/dashboardAssistant.js`
- `routes/crm-assistant.js`
- `prompts/crm-assistant-system.md`
- `js/assistant-rail.js`
- `js/crm-feature-registry.js`
- `docs/ai-context/`
- core page adapters in `js/*-page.js`

### Implementation Options

Option A - docs/runtime context only:

- Update `docs/ai-context`.
- Add compact excerpts for missing pages/entities.

Option B - page adapter expansion:

- Add selected entity/current tab/visible row summaries to high-value pages.

Option C - new canonical domain model:

- Add first-class calls/deals only if product confirms need.
- This likely requires DB/API work and separate approval.

Recommended first slice: Option A + one page adapter expansion.

### Acceptance Criteria

- Assistant does not invent deals/call statuses.
- Current page/entity context is present for selected page.
- Tests cover prompt/context selection.

### Verification

```bash
npx -y -p node@22 -p npm@10 -c "node --test tests/dashboard-assistant.test.js tests/assistant-feature-locator.test.js tests/assistant-output-format.test.js"
npx -y -p node@22 -p npm@10 -c "npm test"
```

## Task 12 - Release Documentation Drift Cleanup

Priority: P1
Type: documentation/process correctness
Production impact: indirect
Protected areas: none if docs-only

### Problem

`package.json` says current version is `0.77.43`, but active docs still mention
`0.60.x` as the active release train. Some active docs also contain historical
release references and encoding artifacts.

This can mislead agents and humans during release work.

### Goal

Make active release docs agree with `package.json` and current release process.

### Files To Inspect

- `package.json`
- `README.md`
- `AGENTS.md`
- `CHANGELOG.md`
- `docs/RELEASE_RELIABILITY.md`
- `scripts/version-sync.js`
- `scripts/current-version.js`

### Implementation Steps

1. Run `npm run version:current` under Node 22/npm 10.
2. Identify all active docs that say `0.60.x`.
3. Decide whether current train is `0.77.x` or whether docs should avoid a
   hardcoded train entirely.
4. Update docs in Ukrainian where user-facing.
5. Do not edit historical changelog entries unless they are active source of
   truth.

### Acceptance Criteria

- Active docs no longer contradict `package.json`.
- Historical docs remain clearly historical.
- Version commands remain source of truth.

### Verification

```bash
npx -y -p node@22 -p npm@10 -c "npm run version:current"
npx -y -p node@22 -p npm@10 -c "npm run check:version"
git diff --check
```

## Task 13 - Public API Exception Security Review

Priority: P1/P2
Type: security audit
Production impact: yes if behavior changes
Protected areas: external webhooks, auth boundary

### Problem

There are 34 public API exceptions and 2 query-token routes. They are tracked,
but the count is high enough to justify regular review.

### Goal

Prove every public endpoint has one of:

- no sensitive output;
- provider secret validation;
- API key validation;
- rate limiter;
- read-only public purpose;
- focused tests.

### Files To Inspect

- `config/authBoundary.js`
- `middleware/apiAuthBoundary.js`
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

### Required Output

Create:

```text
docs/PUBLIC_API_EXCEPTION_AUDIT_YYYY-MM-DD.md
```

For each exception include:

- method/path/prefix;
- owner;
- data exposed or mutated;
- guard mechanism;
- rate limit;
- test coverage;
- risk rating;
- recommendation.

### Acceptance Criteria

- No endpoint is marked "unknown".
- High-risk endpoints get implementation tasks.
- Docs and config remain aligned.

### Verification

```bash
npx -y -p node@22 -p npm@10 -c "npm run check:auth-boundary"
npx -y -p node@22 -p npm@10 -c "node --test tests/auth-boundary.test.js tests/route-smoke.test.js"
```

## Recommended Execution Order

1. Task 00 - Optimization Discovery And Task Quality Pass.
2. Task 01 - Local Runtime Alignment.
3. Task 12 - Release Documentation Drift Cleanup.
4. Task 02 - PostgreSQL CI And Live API Verification.
5. Task 03 - Browser, Visual, And Accessibility Gate.
6. Task 04 - Upload Durability discovery, then one storage implementation
   slice.
7. Task 05 - Scheduler side-effect discovery, then `checkBookingPushReminders`.
8. Task 13 - Public API Exception Security Review.
9. Task 08 - Observability minimal no-dependency slice.
10. Task 06 - DB startup surface reduction discovery.
11. Task 07 - Frontend session and CSP discovery.
12. Task 11 - Assistant context completion.
13. Task 09 and Task 10 - frontend/backend decomposition slices.

## First Recommended Implementation Pack

Start with a low-risk quality pack:

1. Add runtime wrapper scripts or docs for Node 22 verification.
2. Clean active release docs drift around `0.60.x` vs current package version.
3. Create the Task 00 execution map.

Why this first:

- No DB/auth/deploy changes.
- Reduces future agent mistakes.
- Makes every heavy task easier to execute.
- Can be verified with docs/scripts checks and `npm test`.

## Final Reporting Template For Each Task

Each task close-out should include:

1. Root cause or implementation decision.
2. Files changed.
3. What changed.
4. Verification performed and results.
5. Remaining risks.
6. Recommended next action.

