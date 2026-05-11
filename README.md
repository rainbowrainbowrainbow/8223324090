# Event Genix CRM

Event Genix is an AI-first CRM for event and children's entertainment-center operations. The repository contains one Node.js/Express application, PostgreSQL data access, Telegram/report-bot integrations, static HTML/CSS/vanilla JS frontend pages, and operational modules for bookings, tasks, staff, HR, finance, warehouse, reports, chat, content, and related workflows.

For agent-specific working rules, start with [AGENTS.md](AGENTS.md).

## Runtime Shape

- Runtime: Node.js `>=18.0.0`
- Package manager: npm with `package-lock.json`
- Entrypoint: `server.js`
- Backend: Express routes in `routes/`, services in `services/`, middleware in `middleware/`
- Database: PostgreSQL through raw `pg`, with `db/index.js` and SQL migrations in `db/migrations/`
- Frontend: root-level HTML pages, `js/`, `css/`, and static assets
- API docs: `/api-docs` and `/api-docs.json` when the server is running

Startup initializes the DB, runs migrations, mounts API/static routes, configures Telegram/report-bot hooks when env vars are present, starts schedulers, and initializes WebSocket support.

## Local Setup

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

## Verification Commands

Use the commands that are actually present in `package.json` and scripts:

```bash
npm test
npm run verify
npm run check:version
npm run check:syntax
npm run test:unit
npm run test:ui
npm run test:api
npm run test:integration
npm run health
```

Notes:
- `npm test` runs the fast local baseline: version sync check, JavaScript parser check, unit tests, and UI/static smoke.
- `npm run verify` is the same baseline command spelled explicitly for agents.
- `npm run check:version` checks version references without editing files.
- `npm run check:syntax` parses repository JavaScript with Node; it is not a style lint, typecheck, or build.
- `npm run test:unit` runs self-contained Node tests that do not need a live server.
- `npm run test:ui` runs the jsdom static/UI smoke check for key pages, critical JS syntax, navigation exports, and shared page structure.
- `npm run test:api` runs `tests/api.test.js` and expects a configured local app/database.
- `npm run test:integration` runs the broader `tests/*.test.js` suite and also expects a configured local app/database.
- `node --test tests/<file>.test.js` is still preferred for focused service or route tests.
- `npm run version:sync` runs the same version tool in fix mode and edits files.
- There is no current style lint, TypeScript typecheck, build, or GitHub Actions CI pipeline.

## Version And Changelog Discipline

`package.json` is the version source of truth. The version helper is `scripts/version-sync.js`; it checks `package-lock.json`, visible UI labels, latest changelog markers, asset cache tags, service-worker cache names, and known inline asset references.

For user-visible or deployable product changes:

1. Bump `package.json` intentionally.
2. Run `node scripts/version-sync.js` to inspect current version state.
3. Run `npm run version:sync` only when you intend to update generated version references.
4. Update the `index.html` changelog modal entry for the release.
5. Update `CHANGELOG.md` when the change is release-relevant.

Documentation-only changes normally do not need a product version bump unless a release marker is explicitly requested.

If `package.json`, `index.html`, `CHANGELOG.md`, `SNAPSHOT.md`, standalone page cache tags, or service-worker cache names disagree, trust `package.json` first and report the mismatch.

## Deploy And Branch Policy

The project is documented as Railway-hosted, but historical docs disagree on the exact production branch/source. Current repo rules therefore use a stop-and-ask policy:

- Do not deploy unless explicitly asked.
- Do not push to `deployed` unless the user confirms the target branch/environment.
- Do not change Railway settings or production env vars without explicit confirmation.
- Do not upload files through GitHub UI.

## Worktree And Change Hygiene

- Check `git status --short --branch` before editing.
- Do not overwrite local work you did not create.
- If the worktree is dirty, classify the dirty files before editing and keep unrelated changes out of your diff.
- Keep changes small and reviewable.
- Avoid broad refactors unless the task explicitly calls for them.
- Treat old audits, handoffs, and plans as evidence, not guaranteed truth.

## Shared UI And Access Patterns

Navigation and access logic is shared across server and frontend code:

- `middleware/auth.js` server `PAGE_ACCESS`
- `js/auth.js` frontend `PAGE_ACCESS`
- `js/components/sidebar.js` `NAV_ITEMS` and `SIDEBAR_ACCESS`

When changing pages, roles, navigation, or shared UI, inspect all related areas. Preserve loading, error, empty, disabled, focus, keyboard, and ARIA behavior when touching shared components.

## Key Docs

- [AGENTS.md](AGENTS.md) - operational rules for Codex and other agents
- [CLAUDE.md](CLAUDE.md) - older Claude/OpenClaw-oriented project guidance
- [PROJECT_PASSPORT.md](PROJECT_PASSPORT.md) - historical project map and environment notes
- [CHANGELOG.md](CHANGELOG.md) - historical changelog, currently not always in sync with `index.html`
- [SNAPSHOT.md](SNAPSHOT.md) - historical session snapshot, may be stale
- [OPENCLAW_INTEGRATION.md](OPENCLAW_INTEGRATION.md) - OpenClaw integration notes, partially stale

When these files conflict with current code or `package.json`, prefer current repo evidence and update the relevant docs as part of a focused documentation task.
