# Event Genix Cleanup Register

This register is the active cleanup map for the Event Genix CRM monolith. It is
not a historical audit. Use it to choose small cleanup packs, record why each
pack matters, and keep deletion/refactor work tied to tests.

Last refreshed: 2026-05-12  
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

Known high-change areas from the latest manual snapshot:

- `routes/`: 76 files, API ownership and auth boundaries.
- `services/`: 49 files, business logic and scheduler side effects.
- `js/`: 54 files, large vanilla frontend modules.
- `css/`: 25 files plus `landing/style.css`, shared UI and page-specific styling.
- `tests/`: 85 files, mixed unit, route smoke, UI smoke, and live API tests.
- `db/migrations/`: 159 migrations, with documented legacy duplicate/gap debt.
- `landing/`: public landing materials and static assets.

Large files that should not be casually reformatted:

- `js/chat-page.js`
- `css/chat.css`
- `landing/style.css`
- `css/features.css`
- `css/modals.css`
- `index.html`
- `services/guardian.js`
- `js/settings.js`
- `routes/chat.js`
- `services/scheduler.js`
- `routes/hr.js`

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

Status: CSS ownership guard added; large CSS consolidation remains open.

2026-05-12 CSS update:

- Added `docs/CSS_SURFACE.md`, `config/cssSurface.js`, and
  `npm run check:css-surface`.
- Current CSS surface is explicit: 25 files under `css/` plus
  `landing/style.css`.
- Current Service Worker CSS app-shell precache entries are tied to the same
  manifest so cache-sensitive CSS changes require docs and verification.

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
- `checkBookingPushReminders` is documented as a runtime-risk follow-up: it is
  scheduled every minute but currently relies on `guardScheduler` default
  `daily` dedup. Do not change it without notification-focused tests.

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
| P3 | Large CSS consolidation | Reduces UI drift | `npm run test:ui` plus browser smoke |

## Open Questions To Resolve Before Destructive Cleanup

- Which Railway branch/environment is the production deploy source?
- Which root HTML pages are intentionally public entrypoints?
- Which legacy design upload files should be migrated from local disk to
  Supabase Storage first?
- Which historical planning docs should remain at repo root for humans?
- Which DB seed/bootstrap responsibilities are still required for fresh
  customer environments?
