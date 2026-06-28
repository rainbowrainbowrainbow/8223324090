# Event Genix Cleanup Register

This register is the active cleanup map for the Event Genix CRM monolith. It is
not a historical audit. Use it to choose small cleanup packs, record why each
pack matters, and keep deletion/refactor work tied to tests.

Last refreshed: 2026-06-24
Current product version source: `package.json`

## Operating Model

Cleanup should move in small, deployable packs. Each pack should have:

- a narrow ownership area;
- a clear reason the cleanup reduces risk or future work;
- focused tests first;
- the full local baseline before commit;
- no destructive database or filesystem cleanup without explicit approval.

Do not mix product feature work with broad cleanup. If a cleanup uncovers a
product bug, either fix it in the same narrow area with tests or record it here
as a later pack.

## Current Scale Snapshot

Use `npm run cleanup:inventory` for the current generated view.

Known high-change areas from the latest inventory snapshot:

- `routes/`: 81 files, API ownership and auth boundaries.
- `services/`: 104 files, business logic and scheduler side effects.
- `js/`: 67 files, large vanilla frontend modules.
- `css/`: 74 files, shared UI and page-specific styling.
- `tests/`: 159 files, mixed unit, route smoke, UI smoke, and live API tests.
- `db/migrations/`: 249 migrations, with documented legacy duplicate/gap debt.
- `landing/`: 12 public landing materials and static assets.

Large files that should not be casually reformatted:

- `index.html`
- `js/dashboard-page.js`
- `js/chat-page.js`
- `js/hr-page.js`
- `js/profile-page.js`
- `routes/hr.js`
- `js/booking.js`
- `js/tasks-page.js`
- `profile.html`
- `css/dark-mode.css`
- `landing/style.css`
- `omni.html`
- `js/settings.js`

Do not treat aggregate CSS entrypoints such as `css/assistant-rail.css`,
`css/chat.css`, `css/sidebar-aurora.css`, `css/dashboard.css`, or
`css/pages.css` as large-file targets by filename alone. Their payload now
lives in ordered modules listed in `docs/CSS_SURFACE.md`.

## Cleanup Tracks

### 1. Cleanup Register And System Inventory

Goal: keep one current source of truth for cleanup work.

What to do:

- Keep this register updated after every cleanup pack.
- Use `npm run cleanup:inventory` before choosing a new pack.
- Record active modules, ambiguous modules, and deletion candidates.
- Move old one-off plans to `docs/archive/` only when they are clearly
  superseded and no longer operational.

What this gives:

- Prevents stale handoff notes from driving new work.
- Makes cleanup reviewable instead of subjective.
- Lets the team choose the next pack by risk and value.

Status: started.

2026-05-12 update:

- Added `npm run cleanup:inventory`.
- Moved stale root planning/audit markdown files into `docs/archive/`.
- Root markdown is now intentionally limited to active operating documents:
  `AGENTS.md`, `README.md`, `DB_MIGRATION_GOVERNANCE.md`, and `CHANGELOG.md`.
- Added a static-doc guard test so old root planning docs do not drift back.

2026-05-29 update:

- Refreshed `npm run cleanup:inventory`; no unmounted `routes/*.js` files and
  no orphan root HTML files were reported.
- Removed low-risk frontend debug leftovers from `js/api.js`, `js/chat-page.js`,
  `js/timeline.js`, and `checkin.html`.
- Removed the stale `roomData` profile state slot left after the Room tab
  removal.
- Confirmed `checkin.html` is still a live static page owned by `/checkin`, so
  it is not a deletion candidate.
- Current environment risk: the local shell is Node 24/npm 11 while the repo
  baseline requires Node 22/npm 10, so cleanup verification should still be
  repeated under the canonical runtime before broad deletion packs.

### 2. Route, Page, And Ownership Map

Goal: know which backend route, frontend page, and test owns each product area.

What to do:

- Map `server.js` API mounts to files in `routes/`.
- Map static page routes to root HTML or `landing/` files.
- Mark routes as public, authenticated, custom-secret, or API-key guarded.
- Identify API routers mounted under broad paths such as `/api`.
- Add route smoke coverage when a cleanup touches auth boundaries.

What this gives:

- Reduces the chance of deleting a route used by a hidden page.
- Makes access changes safer because UI visibility and server auth can be
  compared.
- Shows which routes need live PostgreSQL tests instead of only static smoke.

Status: inventory command added; auth classification remains a later pack.

2026-05-12 update:

- Added `config/staticSurface.js` as the machine-readable static surface
  manifest.
- Added `docs/STATIC_SURFACE.md` as the human map for root HTML pages, landing
  pages, and legacy redirects.
- Added `npm run check:static-surface` to the full `npm test` baseline so new
  root HTML pages or route changes must update the map in the same commit.
- Added `docs/API_SURFACE.md`, `config/apiSurface.js`, and
  `npm run check:api-surface` so every `routes/*.js` file must be mounted and
  broad `/api` mounts must be explicit.
- Added `docs/ACCESS_SURFACE.md`, `config/accessSurface.js`, and expanded
  `npm run check:access` so static pages, page aliases, sidebar links,
  hash-modal bridges, and public/embedded access exceptions stay aligned.

2026-06-01 update:

- Clarified Sound ownership: `/api/music` (`routes/music.js`) is the primary
  Sound API for uploads, generated TTS/music, projects, announcements, and
  storage metadata.
- Kept `/api/sound-library` (`routes/sound-library.js`) mounted as legacy
  compatibility CRUD instead of deleting it in a broad cleanup.
- Updated `docs/ai-context` Sound references and added focused Sound generation
  tests so the old disabled Suno state does not drift back.

### 3. Safety Net Before Deletion

Goal: make dead-code removal measurable before deleting files.

What to do:

- Keep `tests/static-cleanup.test.js` as the root media and landing redirect
  guard.
- Keep `tests/static-doc-guard.test.js` as the accidental public-doc exposure
  guard.
- Keep `npm run check:auth-boundary` as the ownership guard for public API
  exceptions and approved `?token=` JWT routes.
- Keep `npm run check:access` as the ownership guard for role metadata,
  backend/frontend `PAGE_ACCESS`, sidebar access, static page access, and
  documented modal/public/embedded exceptions.
- Keep `npm run check:static-surface` as the ownership guard for root HTML,
  landing pages, and legacy static redirects.
- Keep `npm run check:css-surface` as the ownership guard for CSS files,
  runtime references, owners, docs, and Service Worker app-shell CSS precache.
- Keep `npm run check:api-surface` as the ownership guard for backend route
  files, broad `/api` route mounts, and server-level API routes.
- Keep `npm run check:storage-surface` as the ownership guard for local
  `/uploads` paths, Supabase Storage buckets, tests, docs, and ignore rules.
- Keep `npm run check:service-worker-policy` as the ownership guard for
  Service Worker API cache allowlists, sensitive API prefixes, private cache
  cleanup messages, and disabled offline mutation replay.
- Extend `tests/route-smoke.test.js` when public/protected boundaries change.
- Add focused tests before deleting or redirecting any page, asset, or API
  alias.

What this gives:

- Turns cleanup into repeatable verification instead of manual browsing only.
- Catches regressions where legacy URLs, redirects, or static files drift.
- Lets old files be removed with confidence.

Status: existing guards present; expand per pack.

2026-05-12 update:

- Static surface guard added to prevent repeating manual root HTML
  classification work.
- API surface guard added to prevent unmounted route files and undocumented
  broad `/api` route mounts.
- Storage surface guard added to prevent undocumented local upload paths or
  Supabase buckets from being introduced without ownership and tests.
- Auth-boundary guard added to prevent new public API or query-token exceptions
  from bypassing the documented manifest and focused tests.
- Access-surface guard expanded to prevent new pages, aliases, sidebar links,
  or hash-modal access paths from bypassing documented ownership.
- Scheduler-surface guard added to prevent background jobs, raw intervals,
  dedup settings, or test anchors from drifting without ownership.
- DB-startup surface guard added to prevent new legacy schema or startup data
  hooks from being added to `db/index.js` without explicit ownership.
- Service Worker cache/offline policy guard added to prevent private CRM API
  data or mutation replay from being cached without an explicit review.
- CSS surface guard added to prevent new, renamed, or removed CSS files from
  bypassing ownership docs and UI verification.

2026-06-24 production-risk guard update:

- Strengthened `npm run check:db-startup-surface` so startup data hooks must use
  a known ownership mode, and startup data-delete hooks must expose an explicit
  `DELETE` marker.
- Strengthened `npm run check:scheduler-surface` with
  `STATIC_ONLY_SCHEDULER_JOBS`, making scheduler jobs without direct behavior
  tests a tracked cleanup debt instead of an implicit risk.
- Strengthened `npm run check:storage-surface` with fallback policies for every
  `/uploads/*` segment, separating local-filesystem-primary paths from
  Postgres-blob-primary legacy fallback paths.
- Strengthened `npm run check:service-worker-policy` and
  `tests/service-worker-policy.test.js` so `CLEAR_PRIVATE_CACHES` must delete
  the private API cache namespace and legacy offline DB.
- Strengthened `npm run check:static-surface` with explicit exposure
  classification for public root pages, root shell pages, public landing files,
  and embedded aliases.
- No legacy routes, static files, upload folders, DB objects, or production data
  were deleted.

### 4. Security And Deploy-Risk Cleanup

Goal: remove risks that can affect production even when product UI looks fine.

What to do:

- Keep runtime pinned to Node 22/npm 10 and verify with `check:runtime`.
- Continue tightening public endpoint allowlists and rate limits.
- Restrict query-token auth to explicitly approved window-open routes.
- Keep public API exceptions and query-token routes in
  `config/authBoundary.js` and `docs/AUTH_BOUNDARY.md`.
- Keep bootstrap credentials explicit through environment variables only.
- Keep local upload fallback behavior documented against Railway persistence.
- Keep `npm run check:storage-surface` green when adding or changing upload
  paths or Supabase buckets.
- Keep service worker cache behavior away from private or stale API data.
- Keep `npm run check:service-worker-policy` green when changing `sw.js`
  API cache, private cache cleanup, or offline mutation behavior.

What this gives:

- Reduces production-only failures and credential leakage risk.
- Makes Railway deploy behavior match local test behavior.
- Prevents cleanup from re-opening old auth/storage/cache problems.

Status: partially addressed by previous packs; service-worker cache ownership
is now guarded, while broader endpoint rate-limit review remains open.

2026-05-12 update:

- Added `docs/AUTH_BOUNDARY.md`, `config/authBoundary.js`, and
  `npm run check:auth-boundary`.
- Public API exceptions now have owners and reasons outside the middleware
  implementation.
- Query-token JWT auth remains limited to the two graduation `window.open`
  endpoints: `GET /graduation/quotes/:id/proposal` and
  `GET /graduation/catalog/export`.
- Removed duplicate route-level `req.query.token` handling from
  `routes/graduation.js`; query-token auth now has one implementation point in
  `middleware/apiAuthBoundary.js`.

Previous 2026-05-12 storage update:

- Added `docs/STORAGE_SURFACE.md`, `config/storageSurface.js`, and
  `npm run check:storage-surface`.
- Current local upload paths are now explicit: `/uploads/chat`,
  `/uploads/sounds`, and `/uploads/designs`.
- Current Supabase Storage buckets are now explicit: `chat-uploads`,
  `audio-library`, and `catalog-images`.
- `/uploads/designs` is documented as the main local-only legacy storage risk
  and a later migration candidate.

2026-05-12 Service Worker cache update:

- Added `docs/SERVICE_WORKER_CACHE_POLICY.md`,
  `config/serviceWorkerPolicy.js`, and
  `npm run check:service-worker-policy`.
- Current Service Worker API GET cache policy is explicit default-deny:
  only `/api/version` and `/api/status/public` are cacheable, and only without
  an `Authorization` header.
- Offline mutation replay remains disabled by an empty
  `MUTATION_QUEUE_ALLOWLIST`; any future endpoint requires conflict handling,
  idempotency, docs, and focused tests in the same commit.

### 5. Database And Migration Cleanup

Goal: reduce split-brain schema ownership without breaking startup.

What to do:

- Follow `DB_MIGRATION_GOVERNANCE.md`.
- Add new durable schema changes only in `db/migrations/`.
- Do not remove `initDatabase()` schema blocks until the equivalent migration
  path is proven on an empty database.
- Move one small startup responsibility at a time into migrations.
- Run `npm run check:migrations` after migration changes.

What this gives:

- Stops future drift between startup bootstrap and migration history.
- Makes schema changes auditable and repeatable across environments.
- Lowers the risk of Railway startup surprises.

Status: governance exists; gradual migration ownership cleanup remains open.

2026-05-12 update:

- Added `docs/DB_STARTUP_SURFACE.md`, `config/dbStartupSurface.js`, and
  `npm run check:db-startup-surface`.
- Current `initDatabase()` compatibility surface is now explicit: 39 startup
  tables, 38 compatibility columns, 66 indexes, the bookings updated-at
  trigger/function pair, and 10 startup data hooks.
- Future DB work should add durable schema through `db/migrations/`; changing
  the startup surface now requires updating the manifest and docs in the same
  commit.

2026-06-24 DB startup guard update:

- Startup data hook modes are now validated against
  `STARTUP_DATA_BOOTSTRAP_MODES`.
- The existing `greetingCacheStartupDelete` hook remains documented as
  `startup-data-delete`; no startup cleanup was executed.

### 6. Static Frontend Cleanup

Goal: reduce root HTML, JS, and CSS sprawl without changing user workflows.

What to do:

- Classify each root HTML file as live, redirected legacy, embedded, public, or
  deletion candidate.
- Avoid broad CSS rewrites; prefer page-scoped removals with visual checks.
- Split large JS only when a stable domain boundary already exists.
- Keep `npm run check:css-surface` green when adding, removing, renaming, or
  consolidating CSS files.
- Keep shared helpers in `js/ui.js`, `js/api.js`, `js/auth.js`, and
  `js/components/sidebar.js` consistent.

What this gives:

- Makes the static frontend easier to reason about.
- Reduces duplicate styling and script drift.
- Avoids breaking standalone pages that depend on shared globals.

Status: CSS ownership guard active; several large CSS entrypoints are now
aggregate-only files with module payloads. Remaining frontend cleanup should be
chosen from the current inventory and only split JS when a stable domain
boundary already exists.

2026-05-12 CSS update:

- Added `docs/CSS_SURFACE.md`, `config/cssSurface.js`, and
  `npm run check:css-surface`.
- CSS ownership became explicit through the manifest instead of relying on
  informal filename conventions.
- Current Service Worker CSS app-shell precache entries are tied to the same
  manifest so cache-sensitive CSS changes require docs and verification.

2026-06-08 CSS cleanup update:

- Split the assistant rail, chat, sidebar aurora, dashboard, and shared page
  CSS entrypoints into ordered modules while preserving the public stylesheet
  URLs used by HTML and JavaScript.
- Updated `docs/CSS_SURFACE.md` and `config/cssSurface.js` so CSS ownership,
  Service Worker precache expectations, and `npm run check:css-surface` match
  the modular layout.
- Current CSS surface from `npm run cleanup:inventory` is 74 files under
  `css/`; `npm run check:css-surface` tracks 75 referenced CSS files including
  `landing/style.css`. `css/dashboard.css` and `css/pages.css` are no longer
  cleanup candidates by size; use their imported modules for any future scoped
  work.

### 7. Backend Domain Cleanup

Goal: clean routes and services by domain instead of by file size.

Suggested packs:

- Chat and Guardian delivery.
- HR and staff accounts.
- Finance, reports, and report-bot.
- Bookings, afisha, and scheduling.
- Landing, leads, and sales funnel.
- Gamification, wallet, shop, quests, and minigame.

What to do:

- For each domain, identify route files, service files, frontend files, tests,
  DB tables, schedulers, and external integrations.
- Keep transaction/idempotency behavior explicit.
- Add focused tests around any side-effect cleanup.

What this gives:

- Keeps cleanup tied to business workflows.
- Avoids cross-domain regressions.
- Makes large files shrink only when the extracted boundary is real.

Status: open.

2026-06-08 HR payroll-period update:

- Extracted the HR salary period range, lock, event journal, and reconciliation
  helpers from `routes/hr.js` into `services/hrPayrollPeriod.js`.
- Kept HR salary route handlers, permission middleware, public URLs, and API
  response shape in `routes/hr.js`; this was a backend helper ownership cleanup,
  not an endpoint split.
- Updated HR salary contract/static guardrails so the route remains responsible
  for `/api/hr/salary*` surfaces while the payroll-period service owns lock and
  event helper behavior.
- Next HR backend candidates should start from a similarly narrow domain slice:
  onboarding task-owner sync or staff resource/document lifecycle, with focused
  tests before moving route handlers.

2026-06-08 HR onboarding assignment update:

- Extracted the HR onboarding responsible-owner assignment, progress metadata,
  transaction wrapper, audit write, and generated task synchronization helpers
  from `routes/hr.js` into `services/hrOnboarding.js`.
- Kept `/api/hr/onboarding*` and `/api/hr/staff/:id/onboarding-assignment`
  route handlers, permission middleware, public URLs, and response shapes in
  `routes/hr.js`.
- Added a focused HR contract guard so onboarding routes stay thin while the
  service owns `hr_onboarding` task sync, owner reassignment history, and audit
  side effects.
- Next HR backend cleanup candidate: staff resource/document lifecycle. Keep it
  separate from account-center or access-control changes unless a regression is
  found.

2026-06-08 HR staff documents update:

- Extracted private HR staff document upload validation, metadata mapping,
  create/list/download/archive SQL, checksum calculation, and safe download
  filename handling from `routes/hr.js` into `services/hrStaffDocuments.js`.
- Kept `/api/hr/staff/:id/documents*` route handlers, `requireHrManage`,
  guarded binary download headers, and HR audit calls in `routes/hr.js`.
- Added a focused HR contract/service test with fake DB coverage for list,
  create, archive, download URL metadata, checksum payloads, and active-only
  filtering.
- Staff resource issue/return remains the next candidate, but it should be a
  separate pack because it mutates warehouse stock, movement history, costumes,
  and HR audit state transactionally.

2026-06-08 HR staff resources update:

- Extracted HR staff resource list/options, issue, return, resource
  normalization, assignment metadata mapping, and warehouse/costume transactional
  side effects from `routes/hr.js` into `services/hrStaffResources.js`.
- Kept `/api/hr/staff/:id/resources*`, `/api/hr/resource-options`,
  `requireHrManage`, response shapes, and HR audit calls in `routes/hr.js`.
- Added a focused HR contract/service test with fake DB coverage for
  `BEGIN`/`COMMIT`, rollback ownership, warehouse stock decrement/increment,
  `warehouse_history`, `warehouse_stock_movements` issue/return rows, and
  costume unassignment on return.
- Next HR backend cleanup candidate: staff payroll-scheme or role-assignment
  helpers only if a similarly narrow boundary is confirmed. Do not continue
  splitting HR route code by file size alone.

2026-06-08 HR payroll-scheme update:

- Extracted HR staff payroll-scheme metadata mapping, scheme type labels,
  hybrid/hourly/manual config normalization, staff scheme workspace loading, and
  create payload assembly from `routes/hr.js` into
  `services/hrPayrollSchemes.js`.
- Kept `/api/hr/staff/:id/payroll-scheme`, `requireHrManage`, response shapes,
  missing-staff handling, and `staff_payroll_scheme_update` audit calls in
  `routes/hr.js`.
- Added a focused HR contract/service test with fake DB coverage for scheme
  workspace loading, active scheme selection, config parsing, hybrid rules,
  invalid date normalization, and create payload/audit mapping.
- Staff role-assignment replacement remains a possible candidate, but it is
  coupled to broader staff edit flows through profession validation and rate
  replacement. Treat it as a separate audit, not as a follow-up by size.

### 8. Scheduler, Event, And Callback Cleanup

Goal: keep background work restart-safe and duplicate-safe.

What to do:

- Treat `services/scheduler.js`, event bus delivery, Telegram callbacks,
  report-bot callbacks, and Guardian outbox as side-effect systems.
- Prefer idempotency keys, atomic claims, and explicit terminal states.
- Keep stale callback cleanup and keyboard cleanup covered by tests.
- Do not remove retry or fallback paths until failure semantics are documented.

What this gives:

- Prevents duplicate messages, duplicate tasks, and partial writes.
- Makes background failures observable instead of silent.
- Protects operational workflows during refactors.

Status: Guardian has recent convergence/repair work; broader scheduler cleanup
remains open.

2026-05-12 update:

- Added `docs/SCHEDULER_SURFACE.md`, `config/schedulerSurface.js`, and
  `npm run check:scheduler-surface`.
- Current `server.js` scheduler startup now has an explicit manifest for
  guarded jobs, raw intervals/starters, dedup cadence, owners, side-effect
  classes, and test anchors.
- `checkBookingPushReminders` was documented as a runtime-risk follow-up: it is
  scheduled every minute and previously relied on `guardScheduler` default
  `daily` dedup. Any change must keep notification-focused tests.

2026-06-24 scheduler guard update:

- `STATIC_ONLY_SCHEDULER_JOBS` now records the guarded and raw scheduler jobs
  that still have only static coverage.
- `npm run check:scheduler-surface` fails if the static-only list stops
  matching jobs without direct test anchors.

2026-06-28 scheduler behavior update:

- Added direct self-contained coverage for `checkBookingPushReminders`.
- Made its scheduler registration explicitly no-dedup at guard level so the
  60-second booking reminder scan is not silently daily-gated.
- Removed `checkBookingPushReminders` from `STATIC_ONLY_SCHEDULER_JOBS`.
- `npm run check:scheduler-surface` now rejects hidden
  `guardScheduler` default daily dedup usage.

2026-06-28 scheduler guard contract update:

- Added direct self-contained coverage for `guardScheduler` dedup behavior.
- `dedup: '5min'` now has real five-minute bucket behavior instead of acting
  like no dedup.
- Explicit `dedup: null` now remains no-skip behavior and writes a minute-level
  tracking key for observability.
- Unsupported dedup values now fail before the scheduler function can run.

2026-06-28 event bus outbox relay update:

- Added direct self-contained coverage for `processOutbox` without a live DB,
  server, Telegram, push, webhook, or external side effects.
- Locked down the outbox relay contract for empty queues, successful publish,
  row-level failure retries, mixed batches, duplicate relay attempts, already
  locked/published rows, retry-limit blocking, and idempotency-key duplicates.
- `processOutbox` now schedules downstream rule processing only after a
  successful transaction `COMMIT`, so rollback or commit failure cannot start
  event rule side effects from an uncommitted relay transaction.
- `eventBusProcessOutbox` was removed from `STATIC_ONLY_SCHEDULER_JOBS`; it
  remains a raw interval and still has no `scheduler_executions` pause/error
  accounting.

2026-06-28 Telegram retry queue hardening:

- Added direct self-contained coverage for `processRetryQueue` without real
  Telegram sends, tokens, server startup, or live database access.
- Locked down empty queue, enqueue metadata, retry success, retry failure,
  retry exhaustion, overlap skip, and guard reset behavior.
- `processRetryQueue` now has an in-process overlap guard with `finally` reset,
  so overlapping raw interval ticks in one Node.js process cannot send the same
  in-memory retry item twice.
- `telegramRetryQueue` was removed from `STATIC_ONLY_SCHEDULER_JOBS`; it
  remains an in-memory raw interval and is still not durable across restarts or
  shared across multiple app instances.

2026-06-28 task lifecycle raw scheduler hardening:

- Added direct self-contained coverage for `runTaskLifecycle` without server
  startup or live database access.
- Locked down empty eligible task scans, health-score updates, automatic
  `auto_expired` archives, repeated archive idempotency, overlap skip, guard
  reset after errors, unchanged raw startup/daily timing, and absence of direct
  Telegram/chat/push/webhook side effects.
- `runTaskLifecycle` now has an in-process overlap guard with `finally` reset,
  so overlapping raw startup/daily executions in one Node.js process cannot run
  the lifecycle mutation loop twice at the same time.
- `taskLifecycleStartup` and `taskLifecycleDaily` were removed from
  `STATIC_ONLY_SCHEDULER_JOBS`; they remain raw scheduler paths and still have
  no durable multi-instance lock or `scheduler_executions` pause/error
  accounting.

2026-06-28 marketing raw scheduler hardening:

- Added direct self-contained coverage for `marketingPublishScheduled` and
  `marketingWeeklyPlan` without server startup, live database access, real
  publishers, Telegram, Instagram, OpenAI, webhooks, or external side effects.
- Scheduler-facing marketing wrappers now guard same-process overlap for
  scheduled publishing and weekly plan generation, with `finally` reset after
  success or error.
- The weekly plan wrapper keeps the Wednesday 08:00-08:05 UTC gate and marks
  the in-memory daily run key only after successful generation, so a failed
  generation can retry during the same window.
- `marketingPublishScheduled` and `marketingWeeklyPlan` were removed from
  `STATIC_ONLY_SCHEDULER_JOBS`; both remain raw intervals and still have no
  durable multi-instance lock or `scheduler_executions` pause/error accounting.

2026-06-28 dashboard alert broadcaster hardening:

- Added direct self-contained coverage for `dashboardAlertBroadcaster` without
  server startup, live database access, real WebSocket clients, or user-facing
  broadcasts.
- `startAlertBroadcaster(60000)` now keeps a single interval per Node.js
  process and returns an `already_started` skip result on duplicate starter
  calls instead of replacing the active interval or adding duplicate initial
  timeouts.
- Broadcaster tick errors are logged and contained, and the alert hash is
  marked delivered only after a successful websocket broadcast.
- `dashboardAlertBroadcaster` was removed from `STATIC_ONLY_SCHEDULER_JOBS`; it
  remains a raw starter and still has no durable multi-instance lock or
 `scheduler_executions` pause/error accounting.

2026-06-28 OpenClaw stale message fallback hardening:

- Added direct self-contained coverage for `openclawBridgeStaleMessages`
  without server startup, live database access, real WebSocket clients,
  OpenClaw, Telegram, AI, webhooks, or external side effects.
- Locked down empty stale scans, one-message success, multiple-message order,
  generator failure behavior, top-level DB select errors, overlap skip, guard
  reset after errors, and unchanged `30000` raw interval timing.
- `processStaleMessages()` now has an in-process overlap guard with `finally`
  reset and returns structured results for success, overlap skip, and
  top-level error paths instead of letting top-level scheduler errors escape.
- `openclawBridgeStaleMessages` was removed from
  `STATIC_ONLY_SCHEDULER_JOBS`; it remains a raw interval and still has no
  durable multi-instance lock or `scheduler_executions` pause/error accounting.

2026-06-28 Kleshnya greeting cleanup hardening:

- Added direct self-contained coverage for `cleanupKleshnyaMessages` without
  server startup, live database access, WebSocket clients, OpenClaw, Telegram,
  AI, webhooks, or external side effects.
- Locked down empty cleanup scans, expired-row delete counts, DB query failure
  handling, overlap skip, guard reset after errors, and unchanged
  `30 * 60 * 1000` raw interval timing.
- `cleanupExpired()` now has an in-process overlap guard with `finally` reset
  and returns structured results for success, overlap skip, and query error
  paths.
- `cleanupKleshnyaMessages` was removed from `STATIC_ONLY_SCHEDULER_JOBS`; it
  remains a raw interval and still has no durable multi-instance lock or
  `scheduler_executions` pause/error accounting.

2026-06-28 Telegram and booking notification scheduler coverage pack:

- Added direct self-contained coverage for `checkAutoDigest`,
  `checkAutoReminder`, `checkAutoBackup`, `checkScheduledDeletions`,
  `checkCertificateExpiry`, `checkTaskReminders`, `checkUpcomingBookings`,
  `checkSLABreach`, `checkScheduledAnnouncements`, and
  `checkCertExpiryReminders`.
- The coverage pack mocks DB, Telegram sends/deletes, backup delivery,
  Kleshnya task reminder delegation, Afisha distribution, and event bus
  publishing. It does not start the server, use live database access, send real
  Telegram messages, or call external services.
- Locked down no-eligible-row/no-op behavior, eligible send or mutation paths,
  Telegram failure containment where the job sends/deletes Telegram messages,
  and DB/delegate failure containment.
- The covered jobs were removed from `STATIC_ONLY_SCHEDULER_JOBS`; timing,
  env vars, Telegram config, schema, CI, deploy config, and dependencies were
  left unchanged.
- `guardScheduler` remains the dedup owner for these jobs. This task did not
  add job-internal dedup or durable multi-instance locks.

### 9. Documentation Cleanup

Goal: make active docs trustworthy and old docs clearly historical.

What to do:

- Keep `README.md`, `AGENTS.md`, `DB_MIGRATION_GOVERNANCE.md`, and this file
  as current operational docs.
- Move or mark old task/audit files as superseded when verified.
- Do not copy production credentials, shared passwords, or stale deployment
  claims into active docs.
- Prefer small doc updates attached to the cleanup pack that changed behavior.

What this gives:

- Prevents future agents from following stale instructions.
- Reduces repeated rediscovery work.
- Keeps deploy and migration rules clear.

Status: started with this register.

2026-05-12 update:

- Archived historical root plan/audit documents and documented them in
  `docs/archive/README.md`.
- Added root markdown coverage in `tests/static-doc-guard.test.js`.

### 10. Cleanup Pack Verification Rhythm

Goal: make every cleanup pack shippable.

Required local flow:

```bash
git status --short --branch
npm run check:version
npm run check:migrations
npm run check:syntax
npm run check:access
npx -y -p node@22 -p npm@10 -c "npm test"
git diff --check
```

Focused tests should run before the full baseline. Use the smallest relevant
`node --test tests/<file>.test.js` command when a pack touches a tested area.

What this gives:

- Keeps cleanup deployable through Railway after push.
- Makes failures local and narrow before the full baseline.
- Avoids reporting Node 18/24 results as representative.

Status: active rule for all packs.

## Current Backlog

| Priority | Pack | Why It Matters | Suggested First Check |
| --- | --- | --- | --- |
| Done | Query-token auth restriction | Reduces JWT leakage through URLs | `npm run check:auth-boundary`, `tests/auth-boundary.test.js`, `tests/route-smoke.test.js` |
| Done | Upload storage inventory | Clarifies Railway persistence risk | `npm run check:storage-surface`, `tests/chat-upload-storage.test.js`, `tests/audio-storage.test.js`, `tests/image-storage.test.js` |
| Done | Root HTML ownership map | Prevents accidental live page deletion | `npm run check:static-surface`, `npm run test:ui` |
| Done | API route ownership guard | Prevents orphan route files and undocumented broad mounts | `npm run check:api-surface`, `tests/route-smoke.test.js` |
| Done | Access/sidebar drift expansion | Keeps UI and backend permission rules aligned | `npm run check:access` |
| Done | Scheduler side-effect map | Finds duplicate-prone background jobs | `npm run check:scheduler-surface`, scheduler-focused tests |
| Done | DB startup ownership slice | Reduces `initDatabase()`/migration split-brain | `npm run check:db-startup-surface`, `npm run check:migrations` |
| Done | Old root markdown archive pass | Reduces stale instruction risk | `tests/static-doc-guard.test.js` |
| Done | Service Worker cache policy guard | Prevents stale/private CRM API data from being cached offline | `npm run check:service-worker-policy`, `tests/service-worker-policy.test.js` |
| Done | CSS surface ownership guard | Prevents frontend cleanup from deleting or renaming live styles blindly | `npm run check:css-surface`, `npm run test:ui` |
| Done | HR payroll-period helper extraction | Keeps salary period locks/events/reconciliation out of the HR route monolith without changing `/api/hr/salary*` contracts | `node --test tests/hr-button-contract.test.js`, `npm run test:ui` |
| Done | Cleanup register production-risk guard pack | Makes DB startup hooks, scheduler static-only jobs, storage fallback paths, Service Worker private cache cleanup, and static page exposure explicit without destructive cleanup | `npm run check:db-startup-surface`, `npm run check:scheduler-surface`, `npm run check:storage-surface`, `npm run check:service-worker-policy`, `npm run check:static-surface`, `npm test` |
| P3 | Large CSS consolidation | Reduces UI drift | `npm run test:ui` plus browser smoke |

## Open Questions To Resolve Before Destructive Cleanup

- Which Railway branch/environment is the production deploy source?
- Which root HTML pages are intentionally public entrypoints?
- Which legacy design upload files should be migrated from local disk to
  Supabase Storage first?
- Which historical planning docs should remain at repo root for humans?
- Which DB seed/bootstrap responsibilities are still required for fresh
  customer environments?
