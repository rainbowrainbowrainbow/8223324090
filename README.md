# Event Genix CRM

Event Genix is an AI-first CRM for event and children's entertainment-center operations. The repository contains one Node.js/Express application, PostgreSQL data access, Telegram/report-bot integrations, static HTML/CSS/vanilla JS frontend pages, and operational modules for bookings, tasks, staff, HR, finance, warehouse, reports, chat, content, and related workflows.

For agent-specific working rules, start with [AGENTS.md](AGENTS.md).

## Runtime Shape

- Runtime: Node.js `22.x`
- Package manager: npm `10.x` with `package-lock.json`
- Entrypoint: `server.js`
- Backend: Express routes in `routes/`, services in `services/`, middleware in `middleware/`
- Database: PostgreSQL through raw `pg`, with `db/index.js` and SQL migrations in `db/migrations/`
- Frontend: root-level HTML pages, `js/`, `css/`, and static assets
- API docs: `/api-docs` and `/api-docs.json` when the server is running

Startup initializes the DB, runs migrations, mounts API/static routes, configures Telegram/report-bot hooks when env vars are present, starts schedulers, and initializes WebSocket support.

## Local Setup

Use Node 22 before installing or verifying. The repo pins this in `package.json` `engines`, `.nvmrc`, and `.node-version`; Railway/Nixpacks should read the same baseline instead of falling back to Node 18.

Check the active runtime:

```bash
npm run check:runtime
```

Install dependencies:

```bash
npm install
```

Run the app:

```bash
npm start
```

Run with Node watch mode:

```bash
npm run dev
```

The server uses `PORT` or defaults to `3000`. It expects PostgreSQL through `DATABASE_URL` or standard `PGHOST`/`PGUSER`/`PGDATABASE` variables. In production, `JWT_SECRET` is required by startup validation. Telegram, report-bot, Supabase, and AI integrations are optional unless you are working on those areas.

Dashboard assistant AI/voice runs only through backend secrets:

```bash
OPENAI_API_KEY=<server-side-secret>
OPENAI_ASSISTANT_MODEL=gpt-4.1-mini
OPENAI_TRANSCRIPTION_MODEL=whisper-1
OPENAI_TTS_MODEL=gpt-4o-mini-tts
OPENAI_TTS_VOICE=alloy
```

Do not place OpenAI keys in HTML, browser JavaScript, localStorage, screenshots, changelog text, or seeded data. Without `OPENAI_API_KEY`, `/api/crm-assistant/*` returns a controlled `openai_not_configured` error and the global CRM assistant rail stays in text fallback mode.

## Public Landing Materials

Current public sales/manager materials live under `landing/`:

- `/landing/manager-guide.html`
- `/landing/sales-deck.html`

Legacy root URLs `/manager-guide`, `/manager-guide.html`, `/sales-deck`, and `/sales-deck.html` are kept as temporary 302 redirects to those canonical landing pages. Do not add new loose root HTML pages unless the route, docs, and static-exposure intent are explicit.

## User Bootstrap And Credential Safety

The repository does not ship shared default user credentials. Startup must not create or reset production passwords from hardcoded values.

For a fresh environment, bootstrap the first creator explicitly through env:

```bash
BOOTSTRAP_CREATOR_USERNAME=owner
BOOTSTRAP_CREATOR_PASSWORD=<private-long-password>
BOOTSTRAP_CREATOR_NAME="Owner"
```

For local-only development seeding, set `ALLOW_DEV_USER_SEED=true` and `DEV_SEED_ADMIN_PASSWORD` with a private local password. This path is blocked in production-like Railway environments. Live API tests require `TEST_USER` and `TEST_PASS`; they no longer fall back to shared credentials.

## Verification Commands

Use the commands that are actually present in `package.json` and scripts:

```bash
npm test
npm run verify
npm run check:runtime
npm run check:version
npm run check:access
npm run check:auth-boundary
npm run check:static-surface
npm run check:css-surface
npm run check:api-surface
npm run check:storage-surface
npm run check:service-worker-policy
npm run check:scheduler-surface
npm run check:db-startup-surface
npm run check:migrations
npm run check:syntax
npm run cleanup:inventory
npm run test:unit
npm run test:ui
npm run test:api
npm run test:integration
npm run health
```

Notes:
- `npm test` runs the fast local baseline: runtime check, version sync check, access/sidebar drift check, auth-boundary ownership, static/CSS/API/storage/service-worker/scheduler/DB-startup surface ownership, migration governance check, JavaScript parser check, unit tests, and UI/static smoke.
- `npm run verify` is the same baseline command spelled explicitly for agents.
- `npm run check:runtime` requires Node 22.x and npm 10.x so local verification matches the Railway baseline.
- `npm run check:version` checks version references without editing files.
- `npm run check:access` verifies role metadata, backend/frontend page access, sidebar navigation access, static page access ownership, and documented modal/public/embedded exceptions.
- `npm run check:auth-boundary` verifies that public API exceptions and approved `?token=` JWT routes stay documented and tested.
- `npm run check:static-surface` verifies that root HTML pages, landing pages, legacy redirects, and the documented static surface map stay aligned.
- `npm run check:css-surface` verifies that CSS files, runtime references, owners, docs, and Service Worker app-shell CSS precache entries stay aligned.
- `npm run check:api-surface` verifies that every `routes/*.js` file is mounted from `server.js`, broad `/api` route mounts are explicit, and direct server-level API routes are documented.
- `npm run check:storage-surface` verifies that local `/uploads` paths, Supabase Storage buckets, tests, docs, and ignore rules stay aligned.
- `npm run check:service-worker-policy` verifies that `sw.js` keeps private CRM API data network-only by default and keeps offline mutation replay disabled unless explicitly reviewed.
- `npm run check:scheduler-surface` verifies that guarded scheduler jobs, raw background intervals, dedup settings, test anchors, and scheduler docs stay aligned.
- `npm run check:db-startup-surface` verifies that legacy `initDatabase()` schema shims, startup data hooks, and the two-phase DB startup flow stay documented while durable changes move to SQL migrations.
- `npm run check:migrations` statically checks migration numbering, known legacy gaps/duplicates, and required governance headers for new migrations.
- `npm run check:syntax` parses repository JavaScript with Node; it is not a style lint, typecheck, or build.
- `npm run cleanup:inventory` prints a read-only cleanup inventory: directory sizes, largest files, API mounts, page routes, root HTML exposure, docs, and migration numbering. Use it before starting cleanup packs.
- `npm run test:unit` runs self-contained Node tests that do not need a live server.
- `npm run test:ui` runs the jsdom static/UI smoke check for key pages, critical JS syntax, navigation exports, and shared page structure.
- `npm run test:api` runs `tests/api.test.js` and expects a configured local app/database.
- `npm run test:integration` runs the broader `tests/*.test.js` suite and also expects a configured local app/database.
- `node --test tests/<file>.test.js` is still preferred for focused service or route tests.
- `npm run version:sync` runs the same version tool in fix mode and edits files.
- There is no current style lint, TypeScript typecheck, or build pipeline.

## CI Baseline

GitHub Actions lives in [`.github/workflows/ci.yml`](.github/workflows/ci.yml). It runs on push and pull request using Node 22 from `.node-version`, aligns npm to `10.9.8`, installs with `npm ci`, and runs `npm test`.

The CI gate covers:

- Node/npm runtime alignment through `npm run check:runtime`;
- version and cache-bust consistency through `npm run check:version`;
- access/sidebar/static page access drift through `npm run check:access`;
- API auth-boundary ownership through `npm run check:auth-boundary`;
- migration duplicate/gap/governance checks through `npm run check:migrations`;
- static surface ownership through `npm run check:static-surface`;
- CSS surface ownership through `npm run check:css-surface`;
- API route surface ownership through `npm run check:api-surface`;
- upload/storage surface ownership through `npm run check:storage-surface`;
- Service Worker cache/offline policy ownership through `npm run check:service-worker-policy`;
- scheduler side-effect ownership through `npm run check:scheduler-surface`;
- DB startup surface ownership through `npm run check:db-startup-surface`;
- JavaScript parser checks through `npm run check:syntax`;
- self-contained unit, auth-boundary, and route-level safety smoke tests through `npm run test:unit`;
- static UI smoke through `npm run test:ui`.

The route smoke layer is intentionally shallow: it checks public/protected/custom-secret/API-key boundaries and cheap route contracts such as version, landing, packages, task permissions, user role metadata, and chat-adjacent auth fallback. It does not exercise full PostgreSQL-backed route behavior.

The UI smoke is intentionally shallow: it checks key pages, critical script loading/static structure, navigation exports, and shared page wiring. It does not fully exercise browser rendering, loading/error/disabled states, keyboard behavior, or accessibility; those still need focused manual or browser automation checks when touched.

CI does not run PostgreSQL-backed API/integration suites, production deploy verification, or live Railway health checks. Use `npm run test:api`, `npm run test:integration`, and manual health checks against a configured app/database for those scopes.

## Version And Changelog Discipline

`package.json` is the single source of truth for product release metadata: `version` is the canonical release number and `eventGenix.releaseLabel` is the canonical visible release label. The version helper is `scripts/version-sync.js`; it checks `package-lock.json`, login release badge, tagline, changelog CTA, latest changelog markers, asset cache tags, service-worker cache names, known inline asset references, and the `/api/version` route contract.

The active release train is now `0.50.x`. Mini updates should increment patch only: `0.50.33`, `0.50.34`, `0.50.35`, etc. Existing `v43.*`, `v0.44.*`, `v0.45.*`, `v0.46.*`, `v0.47.*`, `v0.48.*`, and `v0.49.*` changelog entries, code comments, migration notes, and audit docs are historical records; do not use them as the active version source and do not return new release markers to those older lines without an explicit version-policy task.

For user-visible or deployable product changes:

1. Bump canonical metadata with `npm run version:bump -- patch --label "Release Label"` or edit `package.json` intentionally.
2. Update the `index.html` changelog modal entry for the release.
3. Update `CHANGELOG.md` when the change is release-relevant.
4. Run `npm run version:sync` only when you intend to update generated version references.
5. Run `npm run check:version`; it must fail on any drift between `package.json`, visible UI, cache-bust tags, changelog, service-worker caches, or `/api/version` ownership.
6. After deploy, run `npm run version:smoke -- https://<live-crm-host>` and treat a mismatch as an incomplete deploy.

Documentation-only changes normally do not need a product version bump unless a release marker is explicitly requested.

If `package.json`, `index.html`, `CHANGELOG.md`, archived snapshots, standalone page cache tags, or service-worker cache names disagree, trust `package.json` first and report the mismatch.

## Deploy And Branch Policy

The project is documented as Railway-hosted, but historical docs disagree on the exact production branch/source. Current repo rules therefore use a stop-and-ask policy:

- Do not deploy unless explicitly asked.
- Do not push to `deployed` unless the user confirms the target branch/environment.
- Do not change Railway settings or production env vars without explicit confirmation.
- Do not upload files through GitHub UI.
- Railway builds must use Node 22.x. If build logs show Node 18 or engine warnings for Node 20+/22+ dependencies, stop and fix the runtime baseline before treating the deployment as valid.

## Worktree And Change Hygiene

- Check `git status --short --branch` before editing.
- Do not overwrite local work you did not create.
- If the worktree is dirty, classify the dirty files before editing and keep unrelated changes out of your diff.
- Keep changes small and reviewable.
- Avoid broad refactors unless the task explicitly calls for them.
- Treat old audits, handoffs, and plans as evidence, not guaranteed truth.

## Database Migration Governance

Schema ownership is currently split between startup bootstrap in `db/index.js` and SQL migrations in `db/migrations/`. Do not add new schema ownership to startup code. New durable schema changes should be explicit SQL migrations, and new migrations from `162_*.sql` onward must include the governance headers described in [DB_MIGRATION_GOVERNANCE.md](DB_MIGRATION_GOVERNANCE.md).

Run `npm run check:migrations` after adding or renaming migrations. Destructive, date-scoped, or staff/customer/finance/payroll data-fix migrations require explicit scope, rollback notes, and operator approval.

## Shared UI And Access Patterns

Navigation and access logic is shared across server and frontend code:

- `middleware/auth.js` server `PAGE_ACCESS`
- `js/auth.js` frontend `PAGE_ACCESS`
- `js/components/sidebar.js` `NAV_ITEMS` and `SIDEBAR_ACCESS`

When changing pages, roles, navigation, or shared UI, inspect all related areas. Preserve loading, error, empty, disabled, focus, keyboard, and ARIA behavior when touching shared components.
The current ownership map and intentional exceptions live in [docs/ACCESS_SURFACE.md](docs/ACCESS_SURFACE.md).

## Key Docs

- [AGENTS.md](AGENTS.md) - operational rules for Codex and other agents
- [DB_MIGRATION_GOVERNANCE.md](DB_MIGRATION_GOVERNANCE.md) - current database migration ownership and safety rules
- [docs/CLEANUP_REGISTER.md](docs/CLEANUP_REGISTER.md) - active cleanup map, cleanup tracks, and backlog
- [docs/ACCESS_SURFACE.md](docs/ACCESS_SURFACE.md) - role/page/sidebar/static access ownership and approved exceptions
- [docs/AUTH_BOUNDARY.md](docs/AUTH_BOUNDARY.md) - public API and query-token auth exception ownership
- [docs/API_SURFACE.md](docs/API_SURFACE.md) - API route-file mounting and server-level API ownership
- [docs/CSS_SURFACE.md](docs/CSS_SURFACE.md) - CSS file, owner, reference, and Service Worker CSS precache ownership
- [docs/DB_STARTUP_SURFACE.md](docs/DB_STARTUP_SURFACE.md) - legacy DB startup schema and data-hook ownership
- [docs/SCHEDULER_SURFACE.md](docs/SCHEDULER_SURFACE.md) - background job, interval, dedup, and side-effect ownership
- [docs/SERVICE_WORKER_CACHE_POLICY.md](docs/SERVICE_WORKER_CACHE_POLICY.md) - Service Worker API cache and offline mutation policy
- [docs/STATIC_SURFACE.md](docs/STATIC_SURFACE.md) - root HTML, landing page, and legacy static route ownership
- [docs/STORAGE_SURFACE.md](docs/STORAGE_SURFACE.md) - local upload path and Supabase Storage bucket ownership
- [CHANGELOG.md](CHANGELOG.md) - release history
- [docs/archive/README.md](docs/archive/README.md) - archive index for historical, non-authoritative docs
- [docs/archive/CLAUDE.md](docs/archive/CLAUDE.md) - older Claude/OpenClaw-oriented project guidance
- [docs/archive/PROJECT_PASSPORT.md](docs/archive/PROJECT_PASSPORT.md) - historical project map and environment notes
- [docs/archive/PROJECT_HANDOFF.md](docs/archive/PROJECT_HANDOFF.md) - historical handoff notes
- [docs/archive/SNAPSHOT.md](docs/archive/SNAPSHOT.md) - historical session snapshot
- [docs/archive/OPENCLAW_INTEGRATION.md](docs/archive/OPENCLAW_INTEGRATION.md) - OpenClaw integration notes

Archived docs are context only. When they conflict with current code, `AGENTS.md`, `README.md`, or `package.json`, prefer current repo evidence and update active docs as part of a focused documentation task.
