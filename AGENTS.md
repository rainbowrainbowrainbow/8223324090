# Event Genix CRM - Codex Working Rules

These rules are for Codex and other coding agents working in this repository.
They are intentionally operational and should be followed before local habits or
stale handoff notes.

## Project Shape

- Event Genix is a Node.js 22.x / npm 10.x Express CRM for event and entertainment-center operations.
- Runtime entrypoint: `server.js`.
- Package manager: npm, with `package-lock.json` committed.
- Database: PostgreSQL through raw `pg`; no ORM or TypeScript.
- Frontend: static HTML, CSS, and vanilla JavaScript.
- Important runtime areas:
  - API routes in `routes/`
  - business logic in `services/`
  - shared auth and request middleware in `middleware/`
  - DB pool/init in `db/index.js`
  - SQL migrations in `db/migrations/`
  - shared frontend helpers in `js/`
  - static pages at repo root

## Runtime Baseline

- Canonical runtime: Node.js `22.x`.
- Canonical package manager: npm `10.x`, recorded as `packageManager` in `package.json`.
- Runtime pins live in `package.json` `engines`, `.nvmrc`, and `.node-version`.
- Railway/Nixpacks should use Node 22 from the package engines or `.nvmrc`; a Railway build falling back to Node 18 is a configuration bug.
- Do not run verification, install, or deploy work on Node 18 or Node 24 and report it as representative.
- Run `npm run check:runtime` before trusting local results if there is any doubt.

## Before Editing

- Run `git status --short --branch`.
- Read the relevant diffs before touching a dirty file.
- Do not revert, overwrite, or reformat local changes you did not make.
- If the worktree is dirty:
  - classify the dirty files first;
  - keep unrelated dirty files out of your diff;
  - ask before destructive cleanup, stash, reset, or checkout;
  - prefer a small isolated commit or explicit handoff over mixing changes.
- Inspect nearby routes, services, frontend files, tests, and docs before editing.
- Keep changes focused. Do not bundle repo cleanup, style churn, or broad refactors with product fixes.

## Commands That Exist

- Install dependencies: `npm install`
- Start server: `npm start`
- Watch mode: `npm run dev`
- Fast local verification baseline: `npm test`
- Full local baseline explicitly: `npm run verify`
- Runtime baseline check: `npm run check:runtime`
- Version consistency check: `npm run check:version`
- Access/sidebar drift check: `npm run check:access`
- JavaScript parser check: `npm run check:syntax`
- Unit tests that do not need a live server: `npm run test:unit`
- Route smoke in the fast baseline is intentionally shallow: public/protected/custom-secret/API-key boundaries and cheap route contracts. It does not replace PostgreSQL-backed API/integration tests.
- UI/static smoke check: `npm run test:ui`
- API smoke suite against a running app/DB: `npm run test:api`
- Broader Node test sweep against a running app/DB: `npm run test:integration`
- Focused Node tests: `node --test tests/<file>.test.js`
- DB migrations standalone: `node db/migrate.js`
- Static migration governance check: `npm run check:migrations`
- Version auto-fix: `npm run version:sync`
- Health check against a running server: `npm run health`

Notes:
- `npm test` intentionally runs the fast local baseline: runtime check, version sync, access/sidebar drift check, migration governance, syntax check, unit tests, and UI smoke.
- `npm run check:runtime` enforces Node 22.x / npm 10.x. Switch runtimes before interpreting other test results.
- `npm run test:api` and `npm run test:integration` expect a running PostgreSQL-backed app at `TEST_URL` or `http://localhost:3000`.
- `npm run check:syntax` is parser-only. It is not a style lint, typecheck, or build.
- There is currently no style lint, TypeScript typecheck, or build pipeline.

## CI Baseline

- GitHub Actions workflow: `.github/workflows/ci.yml`.
- CI runs on push and pull request with Node 22 from `.node-version` and npm `10.9.8`.
- CI installs with `npm ci` and runs `npm test`.
- The CI gate covers runtime alignment, version sync, access/sidebar drift, migration governance, JavaScript parser checks, self-contained unit/auth-boundary/route-smoke tests, and static UI smoke.
- CI does not run PostgreSQL-backed API or integration tests. Use `npm run test:api` or `npm run test:integration` against a configured live app/database when touching DB-backed route behavior.
- CI does not provide a style lint, TypeScript typecheck, production deploy proof, browser automation, or manual UX/accessibility review.

## Versioning And Changelog

- `package.json` is the version source of truth.
- Active release train: `0.44.x`. The base release is `0.44.0`; mini updates increment the patch only (`0.44.1`, `0.44.2`, `0.44.3`, etc.) unless the user explicitly requests a new version-policy transition.
- Do not return active release markers to the old `43.x.x` line or jump to `44.x.x` without an explicit version-policy task. Existing `v43.*` changelog entries, comments, migrations, and audit notes are historical references, not current source-of-truth markers.
- `scripts/version-sync.js` checks/synchronizes version references from `package.json` into `package-lock.json`, HTML asset cache tags, first-screen version text, latest changelog markers, service-worker cache names, and known inline asset references.
- For user-visible or deployable product changes:
  - update `package.json` version intentionally;
  - run `node scripts/version-sync.js` to check current state;
  - use `npm run version:sync` only when you intend to update version references;
  - add/update the `index.html` changelog modal entry;
  - update `CHANGELOG.md` if the change is release-relevant.
- Pure documentation-only changes normally do not need a product version bump unless the user explicitly asks for a release marker.
- If `package.json`, `index.html`, `CHANGELOG.md`, archived snapshots, or service-worker cache versions disagree, trust `package.json` first and report the mismatch instead of guessing.

## Deploy And Branch Boundaries

- Historical docs mention Railway and a `deployed` production branch, but older docs disagree on the exact deploy source.
- Codex must not deploy, push to `deployed`, or alter production settings unless the user explicitly asks and confirms the target branch/environment.
- Never upload files through the GitHub UI.
- If a task depends on knowing the production branch, Railway project, or deploy owner, stop and ask instead of inferring from stale docs.

## Database And Migrations

- Startup currently runs a two-phase DB flow: `initDatabase()`, then `runMigrations(pool)`, then `initDatabase()` again.
- Before schema work, inspect both `db/index.js` and `db/migrations/`.
- Prefer explicit SQL migrations for durable schema changes.
- Follow `DB_MIGRATION_GOVERNANCE.md` for migration ownership, metadata, data-fix, and cleanup rules.
- Run `npm run check:migrations` after adding or renaming migration files.
- New migrations numbered `162_*.sql` or higher must include `MIGRATION_KIND`, `SAFETY`, and `ROLLBACK` headers; destructive or date-scoped migrations need the extra headers documented in `DB_MIGRATION_GOVERNANCE.md`.
- Do not run destructive migrations or data cleanup without explicit user approval.
- If generated or seeded data is involved, identify the source-of-truth script or migration before editing output.
- Do not add shared/default user passwords to code, migrations, docs, tests, or examples.
- First-user bootstrap must be explicit through `BOOTSTRAP_CREATOR_*` env vars. Local-only seed requires `ALLOW_DEV_USER_SEED=true` and `DEV_SEED_ADMIN_PASSWORD`; it must remain blocked in production-like environments.
- Legacy startup code must not reset existing `users.password_hash` values. Use authenticated user-management or an operator-run script for intentional rotation.

## Shared UI, Auth, And Navigation

- Shared access/navigation state is split across:
  - `middleware/auth.js` server `PAGE_ACCESS`
  - `js/auth.js` frontend `PAGE_ACCESS`
  - `js/components/sidebar.js` `NAV_ITEMS` and `SIDEBAR_ACCESS`
- When changing pages, roles, navigation, or access rules, inspect all three areas and keep them consistent.
- Preserve existing loading, error, empty, disabled, focus, keyboard, and ARIA behavior when touching shared UI.
- Prefer existing helpers and patterns in `js/ui.js`, `js/api.js`, `js/auth.js`, and `js/components/sidebar.js`.
- Do not replace shared UI patterns with one-off behavior unless the surrounding code already does that.

## Testing Expectations

- Run the smallest relevant focused tests first.
- For repo-wide sanity, run `npm test`; it does not require a live app or database.
- For route/service changes, prefer `node --test tests/<related>.test.js` when a related test exists.
- For frontend/static changes, run `npm run test:ui` when relevant.
- For broad API changes, run `npm run test:api` or `npm run test:integration` against a configured local server and DB when feasible.
- If a test cannot be run because the environment is missing PostgreSQL, env vars, or a running server, report that explicitly.

## Documentation Sources

- `README.md` is the human entrypoint.
- `docs/archive/` contains useful history from older Claude/OpenClaw workflows, including `CLAUDE.md`, `PROJECT_HANDOFF.md`, `PROJECT_PASSPORT.md`, `SNAPSHOT.md`, and `OPENCLAW_INTEGRATION.md`. These files are not current operating authority.
- Treat old task, handoff, and audit files as evidence, not authority.
- If docs conflict with code or `package.json`, document the conflict and prefer current repo evidence.
