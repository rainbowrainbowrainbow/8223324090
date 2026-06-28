# Event Genix System Optimization Execution Map

Source audit date: 2026-06-27
Execution map date: 2026-06-28
Status: Task 00 output, docs-only
Scope: production hardening, verification quality, architecture cleanup
Production impact: no direct runtime impact for this document; yes for most
implementation tasks it ranks.

## Purpose

This file turns `docs/SYSTEM_OPTIMIZATION_ANALYSIS_AND_TASKS_2026-06-27.md`
into a concrete execution map. It is intentionally not an implementation PR.
The goal is to make the next PR small, reviewable, and backed by repo evidence.

## Evidence Snapshot

Commands run under the canonical runtime unless noted:

- `git status --short --branch`: worktree is already dirty with many unrelated
  release/UI files plus existing docs/test/static-surface work. New
  implementation tasks must inspect dirty diffs before touching those files.
- `npx -y -p node@22 -p npm@10 -c "npm run check:runtime"`: passed with
  Node 22.23.1 / npm 10.9.8.
- `npx -y -p node@22 -p npm@10 -c "npm run cleanup:inventory"`: passed.
- `npx -y -p node@22 -p npm@10 -c "npm test"`: passed; the fast baseline ran
  runtime, version, access, auth-boundary, static/CSS/theme/API/storage,
  service-worker, scheduler, DB-startup, migrations, syntax, unit tests, and
  UI smoke. UI smoke reported 1078 passed / 0 failed.

Current system shape from repo evidence:

- Product version source: `package.json` currently says `0.77.43`.
- Active docs still mention release train `0.60.x`; this is active-doc drift.
- CI has one fast-baseline job on Node 22/npm 10 and runs `npm test`.
- CI does not run PostgreSQL-backed API/integration tests.
- CI does not run browser automation, accessibility checks, production deploy
  proof, or live Railway health checks.
- There is no style lint, TypeScript typecheck, or build pipeline.
- API surface: 84 route files, 85 route mounts, no unmounted route files.
- Static surface: 39 root HTML files, 3 landing files, 8 legacy redirects.
- CSS surface: 81 CSS files, 81 referenced files, 22 Service Worker precache
  entries.
- Storage surface: 5 local upload paths, 0 remote buckets, 1 static mount.
- Local-filesystem-primary binary paths remain for `/uploads/chat`,
  `/uploads/sounds`, and `/uploads/catalog-images`.
- Scheduler surface: 47 guarded jobs and 9 raw intervals/starters.
- Scheduler static-only debt remains high; `checkBookingPushReminders` is a
  known dedup mismatch candidate.
- DB startup surface: 42 startup tables, 52 compatibility columns, 90 startup
  indexes, 10 startup data hooks.
- Auth boundary: 34 public API exceptions and 2 query-token JWT exceptions.
- Service Worker policy: 2 cacheable public API GETs, 28 sensitive prefixes,
  0 offline mutation endpoints.
- Largest risk files include `index.html`, `js/booking.js`,
  `js/dashboard-page.js`, `js/chat-page.js`, `js/hr-page.js`,
  `js/profile-page.js`, `js/timeline.js`, `routes/hr.js`,
  `routes/bookings.js`, and large shared CSS modules.

## Execution Principles

- Start every implementation task with `git status --short --branch`.
- Read dirty diffs before editing a dirty file.
- Use `npx -y -p node@22 -p npm@10 -c "<command>"` when the host shell is not
  already Node 22/npm 10.
- Do not edit DB schema/migrations, auth/session behavior, CI/deploy, env vars,
  secrets, external integrations, dependencies, or production settings without
  explicit confirmation.
- Discovery tasks below are allowed before protected implementation, but they
  must stay docs-only unless confirmation is given.
- Prefer one safe PR per task slice.
- Add focused tests before broad refactors.
- Do not claim live, browser, or PostgreSQL-backed verification unless it was
  actually run.

## Ranked Task List

| Rank | Task | Priority | Recommended Type | Confirmation Needed |
| --- | --- | --- | --- | --- |
| 1 | Local runtime alignment | P0 | small docs/scripts | only if adding tooling/dependency policy |
| 2 | Release documentation drift cleanup | P0 | docs-only first | none if docs-only |
| 3 | PostgreSQL CI discovery | P0 | discovery first | yes before CI/DB job edits |
| 4 | Browser/visual/a11y gate discovery | P0/P1 | discovery first | yes before CI edits |
| 5 | Upload durability discovery | P1 | discovery first | yes before storage/DB/env changes |
| 6 | Scheduler behavior discovery | P1 | discovery first, then one job | yes if cadence/side effects change |
| 7 | Public API exception audit | P1 | security audit docs | yes before auth/webhook behavior changes |
| 8 | Observability no-dependency slice | P1 | design + small API only after review | yes for new endpoint/dependency/env |
| 9 | DB startup reduction discovery | P1/P2 | discovery first | yes before DB/migration changes |
| 10 | Frontend session/CSP discovery | P1/P2 | discovery first | yes before auth/session/CSP behavior changes |
| 11 | Assistant context completion | P2 | docs/runtime context slice | yes for provider/env/domain-model changes |
| 12 | Frontend decomposition slice | P2/P3 | narrow refactor with tests | no unless build/deps added |
| 13 | Backend decomposition slice | P2/P3 | narrow service extraction | yes if DB writes/contracts change |

## Recommended Implementation Order

1. Finish Task 00 with this file.
2. Run a low-risk quality PR: local runtime alignment plus release docs drift
   cleanup. Keep it docs/scripts only and avoid touching protected areas.
3. Run PostgreSQL CI discovery as a docs-only report.
4. Run browser/visual/a11y gate discovery as a docs-only report.
5. Run upload durability discovery before any migration or storage provider
   decision.
6. Run scheduler behavior discovery, then implement exactly one job hardening
   slice after confirmation if cadence changes.
7. Run public API exception audit before changing auth boundary rules.
8. Add observability only as a no-new-dependency design first.
9. Run DB startup reduction discovery before removing any startup shim.
10. Run frontend session/CSP discovery before changing token storage or CSP.
11. Improve assistant context with docs/runtime context only after mapping
    current adapters.
12. Decompose large frontend/backend files only after the verification gaps
    above are smaller.

## Task Details

### 1. Local Runtime Alignment

Priority: P0
Production impact: indirect
Recommended first slice: yes

Problem:

- Repo requires Node 22.x / npm 10.x.
- Current baseline can be forced with `npx -y -p node@22 -p npm@10`.
- Agents can accidentally trust host runtime results when the shell is wrong.

Files to inspect:

- `package.json`
- `scripts/check-runtime.js`
- `.node-version`
- `.nvmrc`
- `README.md`
- `AGENTS.md`

Tests to run:

```bash
npm run check:runtime
npx -y -p node@22 -p npm@10 -c "npm run check:runtime"
npx -y -p node@22 -p npm@10 -c "npm test"
```

Missing tests to create:

- None required for docs-only.
- If scripts are added, add a static assertion only if the repo already has a
  script-manifest pattern; otherwise `check:runtime` is enough.

Protected confirmations:

- None for docs-only or npm scripts that do not add dependencies.
- Confirmation required for Volta/fnm/toolchain policy, dependency changes, or
  lockfile churn.

Blast radius:

- Low for docs.
- Low/medium for `package.json` script edits because `package.json` is already
  release-sensitive and currently dirty in this worktree.

Rollback:

- Revert the docs/script additions only.
- No data rollback.

Acceptance:

- A contributor has one obvious command to run the baseline under Node 22/npm
  10 even if host runtime is wrong.
- Docs explicitly say Node 24/npm 11 results are not representative.

### 2. Release Documentation Drift Cleanup

Priority: P0
Production impact: indirect
Recommended first slice: yes

Problem:

- `package.json` says `0.77.43`.
- Active docs still say the release train is `0.60.x`.
- This can mislead release work and future agents.

Files to inspect:

- `package.json`
- `package-lock.json`
- `README.md`
- `AGENTS.md`
- `CHANGELOG.md`
- `docs/RELEASE_RELIABILITY.md`
- `scripts/version-sync.js`
- `scripts/current-version.js`

Tests to run:

```bash
npx -y -p node@22 -p npm@10 -c "npm run version:current"
npx -y -p node@22 -p npm@10 -c "npm run check:version"
git diff --check
```

Missing tests to create:

- None for docs-only.
- If release docs get a machine-readable source later, add a docs drift check.

Protected confirmations:

- None for docs-only.
- Confirmation required before changing deploy branch policy, production
  release process, CI, or version bump behavior.

Blast radius:

- Low if docs-only.
- Medium if touching `package.json`, `index.html`, `CHANGELOG.md`, `sw.js`, or
  generated cache/version references because those files are release-sensitive.

Rollback:

- Revert docs edits.
- If version sync was run in fix mode accidentally, inspect and revert only the
  generated version references from that task.

Acceptance:

- Active docs no longer contradict `package.json`.
- Historical docs remain historical and are not rewritten as current truth.

### 3. PostgreSQL CI Discovery

Priority: P0
Production impact: yes for implementation
Recommended type: discovery first

Problem:

- CI runs `npm test`, which is fast and useful but intentionally shallow for
  DB-backed API behavior.
- `npm run test:api` and `npm run test:integration` expect a running app/DB and
  are not in CI.

Files to inspect:

- `.github/workflows/ci.yml`
- `README.md`
- `tests/api.test.js`
- `tests/route-smoke.test.js`
- `db/index.js`
- `db/migrate.js`
- `db/migrations/`
- `utils/loadLocalEnv.js`
- `scripts/check-migrations.js`
- `scripts/release-gate.js`

Tests to run during discovery:

```bash
npx -y -p node@22 -p npm@10 -c "npm test"
npx -y -p node@22 -p npm@10 -c "npm run test:api"
npx -y -p node@22 -p npm@10 -c "npm run test:integration"
```

Run the last two only against an isolated local app/database. Do not point them
at production data.

Missing tests to create:

- A minimal PostgreSQL fixture smoke suite that proves migrations, startup,
  auth bootstrap, and one read/write route contract.
- A test-time seed/bootstrap strategy that does not use shared credentials.
- Clear failure logs for migration/startup/API contract failures.

Protected confirmations:

- Required before editing `.github/workflows/ci.yml`.
- Required before adding DB service setup, DB env vars, migration behavior, or
  test database lifecycle scripts.

Blast radius:

- Medium/high. CI runtime and database setup can block all PRs if unstable.

Rollback:

- Keep the DB job separate from the fast baseline.
- Revert only the new CI job and any test-only fixtures.
- Do not change production DB settings.

Acceptance:

- Discovery report lists candidate tests, required env vars, data mutation
  level, runtime duration, and CI readiness.
- Implementation starts with a stable subset, not all integration tests.

### 4. Browser, Visual, And Accessibility Gate Discovery

Priority: P0/P1
Production impact: yes for implementation
Recommended type: discovery first

Problem:

- `npm run test:ui` is jsdom/static oriented.
- It does not prove real browser rendering, responsive layout, focus behavior,
  console errors, canvas/nonblank states, or basic accessibility.

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

Tests to run:

```bash
npx -y -p node@22 -p npm@10 -c "npm run test:browser:booking-summary"
npx -y -p node@22 -p npm@10 -c "npm run test:browser:invite"
npx -y -p node@22 -p npm@10 -c "npm run test:browser:timeline"
npx -y -p node@22 -p npm@10 -c "npm run test:browser:event-cards"
npx -y -p node@22 -p npm@10 -c "npm run test:ui"
```

Missing tests to create:

- Console-error assertion for selected public/auth-free pages.
- Desktop/mobile viewport overlap checks.
- Basic keyboard/focus checks for modal-heavy surfaces.
- Optional accessibility smoke once stable.

Protected confirmations:

- Required before adding browser job to CI.
- Required before introducing new dependencies or hosted browser services.

Blast radius:

- Medium. Browser checks can be flaky if they depend on timing, network, fonts,
  or live credentials.

Rollback:

- Keep browser gate separate from the fast baseline initially.
- Revert the job or remove unstable specs without touching product behavior.

Acceptance:

- Discovery identifies which existing browser scripts are stable enough for CI.
- First implementation covers `booking-summary` and `invite` before private
  authenticated pages.

### 5. Upload Durability Discovery

Priority: P1
Production impact: yes for implementation
Recommended type: discovery first

Problem:

- `/uploads/chat`, `/uploads/sounds`, and `/uploads/catalog-images` still use
  local filesystem as primary binary source with Postgres metadata.
- Railway filesystem should be treated as ephemeral unless a persistent volume
  is explicitly configured.

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

Tests to run:

```bash
npx -y -p node@22 -p npm@10 -c "npm run check:storage-surface"
npx -y -p node@22 -p npm@10 -c "node --test tests/chat-upload-storage.test.js tests/chat-upload-route.test.js"
npx -y -p node@22 -p npm@10 -c "node --test tests/audio-storage.test.js tests/image-storage.test.js tests/profile-avatar-storage.test.js tests/design-storage.test.js"
npx -y -p node@22 -p npm@10 -c "npm test"
```

Missing tests to create:

- Inventory test/report for referenced-but-missing files.
- Orphan file inventory for each upload directory.
- Read-path tests for Postgres-first/local-fallback once a path is migrated.
- Delete/archive tests for binary and metadata consistency.

Protected confirmations:

- Required before DB schema/migration changes.
- Required before adding remote buckets, Railway volumes, env vars, or storage
  provider changes.
- Required before migrating, deleting, or backfilling real uploaded files.

Blast radius:

- High. Files are business/customer-visible and may be referenced by DB rows,
  browser URLs, Telegram messages, or catalogs.

Rollback:

- Discovery rollback is deleting the report only.
- Implementation rollback must preserve legacy local fallback URLs and avoid
  destructive file deletion.

Acceptance:

- Discovery report answers: file counts, DB references, orphans, missing
  references, read paths, candidate storage strategy, and first path to migrate.

### 6. Scheduler Behavior Discovery

Priority: P1
Production impact: yes for implementation
Recommended type: discovery, then one job

Problem:

- Scheduler manifest tracks 47 guarded jobs and 9 raw intervals/starters.
- Many jobs are static-only coverage debt.
- `checkBookingPushReminders` runs every minute but currently has
  `daily-default` dedup visibility.

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

Tests to run:

```bash
npx -y -p node@22 -p npm@10 -c "npm run check:scheduler-surface"
npx -y -p node@22 -p npm@10 -c "node --test tests/scheduled-chat-dispatch.test.js tests/reply-escalation.test.js tests/customer-birthday-tags.test.js"
npx -y -p node@22 -p npm@10 -c "npm test"
```

Missing tests to create:

- Direct behavior test for `checkBookingPushReminders`.
- Idempotency tests for duplicate scheduler ticks.
- Failure-path tests proving errors are logged/tracked and do not duplicate
  side effects.
- Direct behavior tests before removing any job from
  `STATIC_ONLY_SCHEDULER_JOBS`.

Protected confirmations:

- Required before notification cadence changes.
- Required before Telegram/provider side-effect changes.
- Required before converting raw intervals to guarded jobs if behavior changes.

Blast radius:

- High for customer-facing notifications and background mutations.

Rollback:

- Keep one job per PR.
- If cadence change misbehaves, revert the job change and keep manifest debt
  visible.

Acceptance:

- Discovery ranks jobs by side-effect risk.
- First implementation hardens only one job, preferably
  `checkBookingPushReminders`.

### 7. Public API Exception Audit

Priority: P1
Production impact: yes if behavior changes
Recommended type: docs audit first

Problem:

- Auth boundary has 34 public API exceptions and 2 query-token JWT exceptions.
- They are documented, but the count is high enough to require periodic review.

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

Tests to run:

```bash
npx -y -p node@22 -p npm@10 -c "npm run check:auth-boundary"
npx -y -p node@22 -p npm@10 -c "node --test tests/auth-boundary.test.js tests/route-smoke.test.js"
```

Missing tests to create:

- Per-exception guard tests for high-risk public write endpoints.
- Rate-limit assertions for public lead/demo request flows.
- Query-token negative tests for generic protected endpoints if gaps remain.

Protected confirmations:

- Required before changing webhook auth, public route behavior, query-token
  policy, or external integration contracts.

Blast radius:

- Medium/high. Tightening exceptions can break external bots/webhooks; loosening
  them can expose private data.

Rollback:

- Audit rollback is docs-only.
- Behavior rollback must restore route contract and manifest alignment.

Acceptance:

- No exception remains "unknown".
- Every exception has owner, exposed/mutated data, guard mechanism, tests, risk,
  and recommendation.

### 8. Observability And Production Diagnostics

Priority: P1
Production impact: yes for implementation
Recommended type: discovery + no-new-dependency design first

Problem:

- The app has logs and request IDs, but no confirmed APM/error tracking/metrics
  stack in repo evidence.
- Production diagnosis still relies on logs and manual smoke.

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

Tests to run:

```bash
npx -y -p node@22 -p npm@10 -c "npm run check:auth-boundary"
npx -y -p node@22 -p npm@10 -c "npm run check:api-surface"
npx -y -p node@22 -p npm@10 -c "npm test"
```

Missing tests to create:

- Request ID propagation tests for error responses if not already complete.
- Authenticated admin-only diagnostics route tests if a new endpoint is added.
- Scheduler recent-failure summary tests using fake DB/service state.

Protected confirmations:

- Required before adding external APM/error tracking, dependencies, env vars,
  or a new admin diagnostics endpoint.

Blast radius:

- Medium. Observability can leak secrets if careless; new endpoints touch auth
  and API surface.

Rollback:

- Prefer no-new-dependency first.
- Revert route/config/docs/tests as one small slice if needed.

Acceptance:

- Operators can see version, DB readiness, schema status, scheduler failures,
  and provider configuration state without secrets.

### 9. DB Startup Reduction Discovery

Priority: P1/P2
Production impact: yes for implementation
Recommended type: discovery first

Problem:

- Startup still creates/patches legacy schema and runs data hooks.
- Fresh DB parity depends on both `initDatabase()` and migrations.

Files to inspect:

- `db/index.js`
- `db/migrate.js`
- `db/migrations/`
- `config/dbStartupSurface.js`
- `docs/DB_STARTUP_SURFACE.md`
- `DB_MIGRATION_GOVERNANCE.md`
- `scripts/check-db-startup-surface.js`
- `scripts/check-migrations.js`

Tests to run:

```bash
npx -y -p node@22 -p npm@10 -c "npm run check:db-startup-surface"
npx -y -p node@22 -p npm@10 -c "npm run check:migrations"
npx -y -p node@22 -p npm@10 -c "npm test"
```

If an isolated PostgreSQL DB exists:

```bash
node db/migrate.js
npm run test:api
```

Missing tests to create:

- Fresh DB migration/startup parity test.
- Redundant startup shim detection report.
- One candidate removal proof for an index or compatibility column.

Protected confirmations:

- Required before migration edits.
- Required before removing startup schema/data hooks.
- Required before destructive or date-scoped data cleanup.

Blast radius:

- High. Startup changes can break boot, migrations, or old production DBs.

Rollback:

- Discovery rollback is docs-only.
- Implementation rollback must restore startup shim or add a corrective
  migration, depending on what changed.

Acceptance:

- Discovery identifies a safe first removal candidate and proves equivalent
  durable migration coverage.

### 10. Frontend Session And CSP Discovery

Priority: P1/P2
Production impact: yes for implementation
Recommended type: discovery first

Problem:

- Frontend token storage uses browser storage patterns such as `pzp_token` and
  `pzp_refresh_token`.
- CSP allows legacy inline script/style patterns.
- Stronger session boundaries need careful migration.

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

Tests to run:

```bash
npx -y -p node@22 -p npm@10 -c "node --test tests/auth-frontend-session.test.js tests/auth-account-lifecycle.test.js"
npx -y -p node@22 -p npm@10 -c "npm run check:auth-boundary"
npx -y -p node@22 -p npm@10 -c "npm test"
```

Missing tests to create:

- Security header tests if CSP is tightened.
- Refresh-cookie compatibility tests if httpOnly refresh cookies are added.
- Browser login/refresh/logout smoke before broad session migration.

Protected confirmations:

- Required before changing auth/session model.
- Required before invalidating sessions.
- Required before CSP behavior changes that can break inline-heavy pages.

Blast radius:

- Very high. Auth regressions can lock out users or weaken security.

Rollback:

- Use staged compatibility mode if cookies are introduced.
- Keep legacy token path until replacement is proven.

Acceptance:

- Discovery maps every token read/write, refresh endpoint, inline-script
  dependency, and feasible migration step.

### 11. Assistant Product Context Completion

Priority: P2
Production impact: yes if runtime behavior changes
Recommended type: docs/runtime context discovery first

Problem:

- `docs/ai-context/unresolved-questions.md` says calls, deals, UI context
  injection, and component inventory are still unclear.
- Assistant quality can degrade into fake precision when domain mapping is
  missing.

Files to inspect:

- `services/aiProductContext.js`
- `services/dashboardAssistant.js`
- `routes/crm-assistant.js`
- `routes/dashboard-assistant.js`
- `prompts/crm-assistant-system.md`
- `js/assistant-rail.js`
- `js/crm-feature-registry.js`
- `docs/ai-context/`
- selected `js/*-page.js` context adapters

Tests to run:

```bash
npx -y -p node@22 -p npm@10 -c "node --test tests/dashboard-assistant.test.js tests/assistant-feature-locator.test.js tests/assistant-output-format.test.js"
npx -y -p node@22 -p npm@10 -c "npm test"
```

Missing tests to create:

- Prompt/context selection tests for selected high-value pages.
- Negative tests that assistant does not invent deals/call statuses when data is
  absent.
- Page adapter tests for current tab/entity/visible rows if added.

Protected confirmations:

- Required before changing external AI providers, env vars, or introducing
  first-class deals/calls DB/API model.

Blast radius:

- Medium. Runtime prompt/context changes affect assistant answers but should
  not affect core CRM flows if isolated.

Rollback:

- Revert docs/context adapter change.
- Keep prompt changes small and separately testable.

Acceptance:

- Discovery explains what "deal" maps to in Event Genix and what call model
  actually exists.

### 12. Frontend Decomposition Slice

Priority: P2/P3
Production impact: yes if behavior changes
Recommended type: later, after verification gaps shrink

Problem:

- Large vanilla JS/HTML/CSS files increase regression risk.
- No build pipeline, TypeScript, or style lint exists.
- Static loading order and globals are important.

Files to inspect:

- `tests/ui-check.js`
- `index.html`
- `js/booking.js`
- `js/booking-drawer-state.js`
- `js/booking-banquet-selector.js`
- `js/booking-save-path.js`
- `js/dashboard-page.js`
- `js/chat-page.js`
- `js/hr-page.js`
- `js/profile-page.js`
- `js/timeline.js`
- relevant root HTML script tags
- `sw.js` if app-shell assets change

Tests to run:

```bash
npx -y -p node@22 -p npm@10 -c "npm run check:syntax"
npx -y -p node@22 -p npm@10 -c "npm run test:ui"
npx -y -p node@22 -p npm@10 -c "npm test"
```

Add browser smoke for the touched page when available.

Missing tests to create:

- Static global/export tests before moving code.
- Browser smoke for the touched page if none exists.
- Regression tests for script ordering if a new JS file is added.

Protected confirmations:

- None for pure refactor.
- Required before adding build tooling, new dependencies, or changing Service
  Worker cache policy beyond version sync.

Blast radius:

- Medium/high for root shell and booking/timeline files.

Rollback:

- Revert one extraction slice.
- Keep old public globals and script order until replacement is proven.

Acceptance:

- One domain boundary is smaller and behavior is unchanged.
- No broad formatting or unrelated UI redesign.

### 13. Backend Decomposition Slice

Priority: P2/P3
Production impact: yes if behavior changes
Recommended type: later, narrow service extraction

Problem:

- `routes/hr.js` and `routes/bookings.js` remain large.
- Routes should keep permissions and response contracts, while services own
  focused business helpers.

Files to inspect:

- `routes/hr.js`
- `routes/bookings.js`
- existing HR services:
  `services/hrPayrollPeriod.js`, `services/hrOnboarding.js`,
  `services/hrStaffDocuments.js`, `services/hrStaffResources.js`,
  `services/hrPayrollSchemes.js`
- booking helper services/modules if present
- related tests in `tests/`
- `config/apiSurface.js`
- `docs/API_SURFACE.md`

Tests to run:

```bash
npx -y -p node@22 -p npm@10 -c "node --test tests/<focused-domain-test>.test.js"
npx -y -p node@22 -p npm@10 -c "npm run check:api-surface"
npx -y -p node@22 -p npm@10 -c "npm test"
```

Missing tests to create:

- Focused fake-DB service tests before moving route logic.
- Route contract tests if response shape is at risk.
- Transaction rollback tests for side-effect helpers.

Protected confirmations:

- Required before DB writes/schema changes.
- Required before permission/auth changes.
- Required before changing route response contracts.

Blast radius:

- Medium/high for HR and bookings because they touch staff, payroll, timeline,
  finance, and customer workflows.

Rollback:

- Keep route handler surface stable.
- Revert one service extraction without touching unrelated routes.

Acceptance:

- One narrow business helper moves to a service with tests.
- Permission middleware and API response shape remain in the route layer.

## Protected Confirmation Matrix

| Area | Examples | Stop Until Confirmed |
| --- | --- | --- |
| DB schema/migrations | new blob table, startup shim removal, migration headers | yes |
| Auth/session/permissions | httpOnly refresh cookie, query-token policy, page roles | yes |
| CI/CD/deploy | GitHub Actions DB/browser jobs, Railway settings | yes |
| Env/secrets/webhooks | storage buckets, provider keys, webhook tokens | yes |
| External integrations | Telegram, report-bot, Hermes, Kie/OpenAI provider behavior | yes |
| Dependencies/tooling | Playwright in CI policy, Volta/fnm, APM SDK | yes |
| Production data/files | upload migration, deletion, backfill, destructive cleanup | yes |

## First Recommended Implementation Task

Start with a small quality PR:

1. Add/clarify a Node 22/npm 10 verification path in active docs and, if the
   dirty worktree allows clean isolation, add npm wrapper scripts such as a
   Node-22 forced verification command.
2. Clean active release docs drift so they no longer say `0.60.x` while
   `package.json` is `0.77.43`.
3. Do not edit CI, DB, auth, deployment config, env vars, dependencies, or
   production behavior in that PR.

Why this first:

- It reduces future agent mistakes.
- It is low-risk and reviewable.
- It avoids protected areas.
- It makes every later high-risk task easier to verify.

Precondition:

- Inspect current dirty diffs for `package.json`, `package-lock.json`,
  `README.md`, `AGENTS.md`, `CHANGELOG.md`, `index.html`, `sw.js`, and related
  release files before editing. If those files contain unrelated user work,
  keep the first PR docs-only or ask before mixing script changes.

Focused verification for the first PR:

```bash
npx -y -p node@22 -p npm@10 -c "npm run check:runtime"
npx -y -p node@22 -p npm@10 -c "npm run version:current"
npx -y -p node@22 -p npm@10 -c "npm run check:version"
npx -y -p node@22 -p npm@10 -c "npm run check:syntax"
git diff --check
```

Run full baseline if any script or release-source file changes:

```bash
npx -y -p node@22 -p npm@10 -c "npm test"
```

## Rollback Strategy By Workstream

- Docs-only discovery: revert the created discovery file.
- Runtime/docs cleanup: revert docs/script edits; no data impact.
- CI DB/browser jobs: keep as separate jobs; revert job without touching fast
  baseline.
- Upload durability: keep legacy local fallback; never delete files in the same
  PR as a new storage path.
- Scheduler hardening: one job per PR; revert cadence/guard change and keep
  manifest risk visible.
- Auth/session/CSP: use compatibility mode; revert behavior while keeping tests
  that describe the intended boundary if still valid.
- DB startup reduction: never remove a shim without durable migration proof;
  rollback by restoring shim or applying corrective migration after review.
- Frontend/backend decomposition: one domain slice per PR; revert extraction
  only, not unrelated formatting.

## Verification Matrix

Use these command groups by task:

- Task 00 docs-only:

```bash
git diff --check
npx -y -p node@22 -p npm@10 -c "npm run check:syntax"
```

- Repo sanity after non-trivial change:

```bash
npx -y -p node@22 -p npm@10 -c "npm test"
```

- Storage:

```bash
npx -y -p node@22 -p npm@10 -c "npm run check:storage-surface"
npx -y -p node@22 -p npm@10 -c "node --test tests/chat-upload-storage.test.js tests/chat-upload-route.test.js tests/audio-storage.test.js tests/image-storage.test.js tests/profile-avatar-storage.test.js tests/design-storage.test.js"
```

- Scheduler:

```bash
npx -y -p node@22 -p npm@10 -c "npm run check:scheduler-surface"
npx -y -p node@22 -p npm@10 -c "node --test tests/scheduled-chat-dispatch.test.js tests/reply-escalation.test.js tests/customer-birthday-tags.test.js"
```

- Auth/security:

```bash
npx -y -p node@22 -p npm@10 -c "npm run check:auth-boundary"
npx -y -p node@22 -p npm@10 -c "node --test tests/auth-boundary.test.js tests/route-smoke.test.js tests/auth-frontend-session.test.js tests/auth-account-lifecycle.test.js"
```

- DB startup/migrations:

```bash
npx -y -p node@22 -p npm@10 -c "npm run check:db-startup-surface"
npx -y -p node@22 -p npm@10 -c "npm run check:migrations"
```

- Frontend/static:

```bash
npx -y -p node@22 -p npm@10 -c "npm run check:syntax"
npx -y -p node@22 -p npm@10 -c "npm run test:ui"
```

- Browser candidates:

```bash
npx -y -p node@22 -p npm@10 -c "npm run test:browser:booking-summary"
npx -y -p node@22 -p npm@10 -c "npm run test:browser:invite"
```

## Out Of Scope For Task 00

- No code behavior changes.
- No migration/schema edits.
- No auth/session/CSP edits.
- No CI/deploy/Railway changes.
- No env var, secret, webhook, or provider changes.
- No dependency or lockfile changes.
- No upload file migration or deletion.

## Done Criteria For This Map

- Every implementation task points to concrete repo files.
- Protected areas are explicitly marked.
- Every task has focused verification commands.
- Missing tests are named per task.
- First implementation slice is small enough for one safe PR.
- Verification for this docs-only change runs successfully.
