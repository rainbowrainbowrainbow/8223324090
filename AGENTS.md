# Event Genix CRM - Codex Working Rules

These rules are for Codex and other coding agents working in this repository.
They are operational, project-specific, and should be followed before local habits or stale handoff notes.
Keep this file practical: prefer short rules that prevent repeated mistakes.

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
- Use `npm run check:runtime` before trusting local results if there is any doubt.
- If the host shell is on the wrong runtime, use `npx -y -p node@22 -p npm@10 -c "<command>"`, for example `npx -y -p node@22 -p npm@10 -c "npm test"`.

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
- Write user-facing progress summaries, release notes, changelog entries, and deploy summaries in Ukrainian unless the user explicitly asks for another language.

## Commands That Exist

These commands are available. They are not all mandatory for every task; use the delivery and testing rules below to decide what is needed.

- Install dependencies: `npm install`
- Start server: `npm start`
- Watch mode: `npm run dev`
- Fast local verification baseline: `npm test`
- Full local baseline explicitly: `npm run verify`
- Runtime baseline check: `npm run check:runtime`
- Version consistency check: `npm run check:version`
- Current version guard: `npm run version:current`
- Access/sidebar drift check: `npm run check:access`
- API auth-boundary ownership check: `npm run check:auth-boundary`
- Static surface ownership check: `npm run check:static-surface`
- CSS surface ownership check: `npm run check:css-surface`
- API route surface ownership check: `npm run check:api-surface`
- Upload/storage surface ownership check: `npm run check:storage-surface`
- Service Worker cache/offline policy check: `npm run check:service-worker-policy`
- Scheduler side-effect ownership check: `npm run check:scheduler-surface`
- DB startup surface ownership check: `npm run check:db-startup-surface`
- Timeline/booking protected source check: `npm run check:timeline-protected-surface`
- JavaScript parser check: `npm run check:syntax`
- Unit tests that do not need a live server: `npm run test:unit`
- Route smoke in the fast baseline is intentionally shallow: public/protected/custom-secret/API-key boundaries and cheap route contracts. It does not replace PostgreSQL-backed API/integration tests.
- UI/static smoke check: `npm run test:ui`
- API smoke suite against a running app/DB: `npm run test:api`
- Broader Node test sweep against a running app/DB: `npm run test:integration`
- My Day live browser smoke: `npm run smoke:my-day -- https://<live-crm-host>`
- Focused Node tests: `node --test tests/<file>.test.js`
- DB migrations standalone: `node db/migrate.js`
- Static migration governance check: `npm run check:migrations`
- Read-only payroll activation preflight (npm-safe on Windows): `npm run audit:payroll-activation-preflight -- [YYYY-MM] [json|markdown]`
- Read-only payroll post-release audit (npm-safe on Windows): `npm run audit:payroll-post-release -- YYYY-MM [json|markdown]`
- Version auto-fix: `npm run version:sync`
- Health check against a running server: `npm run health`

Notes:
- `npm test` intentionally runs the fast local baseline: runtime check, version sync, access/sidebar drift check, auth-boundary ownership, static surface ownership, CSS surface ownership, API route surface ownership, upload/storage surface ownership, Service Worker cache/offline policy ownership, scheduler side-effect ownership, DB startup surface ownership, timeline/booking protected source ownership, migration governance, syntax check, unit tests, and UI smoke.
- `npm run check:runtime` enforces Node 22.x / npm 10.x. Switch runtimes before interpreting other test results.
- `npm run test:api` and `npm run test:integration` expect a running PostgreSQL-backed app at `TEST_URL` or `http://localhost:3000`.
- `npm run check:syntax` is parser-only. It is not a style lint, typecheck, or build.
- There is currently no style lint, TypeScript typecheck, or build pipeline.

## CI Baseline

- GitHub Actions workflow: `.github/workflows/ci.yml`.
- CI runs on push and pull request with Node 22 from `.node-version` and npm `10.9.8`.
- CI installs with `npm ci`, runs `npm test`, and has separate disposable PostgreSQL/browser jobs for HR/payroll and My Day.
- The CI gate covers runtime alignment, version sync, release helper pre-deploy collision guards, access/sidebar drift, auth-boundary ownership, static surface ownership, CSS surface ownership, API route surface ownership, upload/storage surface ownership, Service Worker cache/offline policy ownership, scheduler side-effect ownership, DB startup surface ownership, migration governance, JavaScript parser checks, self-contained unit/auth-boundary/route-smoke tests, static UI smoke, My Day contract tests, synthetic My Day browser interaction smokes, actual-app My Day browser→API→PostgreSQL smoke, attendance advisory-lock concurrency, attendance backup/recovery, HR onboarding/backfill, payroll profile/simultaneous-pay integration, admission ticket integration, and My Day AI atomic commit integration.
- CI does not run the general PostgreSQL-backed API or unrelated integration suites; it does run targeted isolated PostgreSQL jobs, including `npm run test:integration:payroll-profiles:isolated`, `npm run test:integration:my-day:isolated`, and `npm run test:browser:my-day-actual-app:isolated`.
- CI does not provide a style lint, TypeScript typecheck, production deploy proof, or manual UX/accessibility review.
- My Day AI rollout evidence is operator-run, not automatic CI: use `npm run task-ai-rollout-report -- --events-file <railway-jsonl> --database --format markdown` with a dedicated read-only `TASK_AI_ROLLOUT_DATABASE_URL`. The report must remain redacted and must not use `DATABASE_URL` as a fallback.

## Standard Delivery Workflow

Preferred workflow for normal product work:

`implement -> commit -> push -> CI -> deploy -> live-site QA`

- When the user asks to deliver, release, deploy, ship, finish end-to-end, commit, push, or release product work, proceed through commit, push, CI, deploy, and live-site QA without asking for repeated confirmation.
- Do not turn normal delivery into a local-test-only workflow by default.
- Use CI as the normal automated gate after push.
- Use targeted live-site QA as the normal product verification after deploy.
- If CI fails, diagnose the failed check before continuing delivery.
- If live-site QA fails, report the failed scenario, likely cause, and next fix/rollback step.
- If local verification is skipped, say so clearly in the final summary instead of implying that local tests passed.

## Deploy And Branch Boundaries

- Last verified Railway production release branch (2026-08-01): `codex/lead-guest-context-v08018-final`.
- Production deployment policy (2026-07-20): Railway GitHub auto-deploy is disabled for the production app service. Production deploy must be promoted manually only after the required GitHub CI checks are green for the exact release SHA.
- Before every release or rollback, confirm the active Railway source branch read-only, push only to that confirmed branch, and pass it explicitly as `RELEASE_DEPLOY_BRANCH=<branch>` to `release:railway-up` and release-proof notes.
- Clean/detached worktrees may not have a Railway CLI link. `release:railway-up` must pass the production project ID explicitly; verify `railway status --json` resolves project `fortunate-appreciation`, environment `production`, service `8223324090`, and the live domain before upload. Never run raw `railway up` from an unlinked worktree because the CLI may create a new project.
- Manual Railway deploys must expose deploy evidence through `/api/version`: valid Railway `RAILWAY_GIT_COMMIT_SHA`/`RAILWAY_GIT_BRANCH` metadata, or the exact `eventgenix-release-deployment.json` manifest generated inside the helper's clean `git archive` export. `RELEASE_DEPLOY_COMMIT` and `RELEASE_DEPLOY_BRANCH` are legacy, incomplete metadata; do not set them in Railway or use them as release identity. `npm run release:railway-up` proves the exact uploaded SHA and branch automatically; standalone `npm run version:smoke` must receive `VERSION_SMOKE_EXPECT_COMMIT` and `VERSION_SMOKE_EXPECT_BRANCH`. Release smokes fail closed if metadata is unavailable, manual, malformed, or conflicting.
- Historical docs mention `codex/timeline-leads-hardening` and `deployed`; neither is the active deploy source unless the user explicitly says Railway was reconfigured.
- Never upload files through the GitHub UI.
- If the current user task explicitly asks for deploy, use the active workflow and do not ask for a second deploy confirmation.
- Stop and ask before changing Railway project settings, environment ownership, deploy owner, production secrets, or production settings.

## Versioning And Changelog

- `package.json` is the release source of truth: `version` is the canonical number and `eventGenix.releaseLabel` is the canonical visible release label.
- When the user asks for the current project version, run `npm run version:current` first. If it reports the branch is behind upstream, fast-forward with `git pull --ff-only` or clearly report that the local checkout is stale; do not answer from raw `package.json` alone.
- Do not infer the current active version from this AGENTS.md file. Use `package.json` and `npm run version:current`.
- Do not return active release markers to old `43.x.x`, `0.44.x`, `0.45.x`, `0.46.x`, `0.47.x`, `0.48.x`, `0.49.x`, or older `0.50.x`-`0.76.x` lines without an explicit version-policy task. Existing historical changelog entries, comments, migrations, and audit notes are historical references, not current source-of-truth markers.
- `scripts/version-sync.js` checks/synchronizes version references from `package.json` into `package-lock.json`, HTML asset cache tags, first-screen version text, latest changelog markers, service-worker cache names, and known inline asset references.
- For large UI or product work, prefer reviewable release hygiene: commit the product/UI change first, then make a separate version/cache-sync commit only when preparing the release. Do not mix generated cache-tag churn into the main UI diff unless the user explicitly asks for a single release commit.
- For user-visible or deployable product changes, apply release/versioning rules automatically as part of delivery when relevant:
  - update `package.json` version intentionally;
  - run `node scripts/version-sync.js` to check current state;
  - use `npm run version:sync` only when you intend to update generated version references;
  - use `npm run version:bump -- patch --label "Release Label"` for the canonical patch-release flow when starting a release bump;
  - after deploy, use `npm run version:smoke -- https://<live-crm-host>` to verify live `/api/version`, deployment commit/branch metadata, and login HTML match `package.json`;
  - add/update the `index.html` changelog modal entry;
  - update `CHANGELOG.md` if the change is release-relevant.
- User-facing release notes must be written in Ukrainian.
- Pure documentation-only changes normally do not need a product version bump unless the user explicitly asks for a release marker.
- If `package.json`, `index.html`, `CHANGELOG.md`, archived snapshots, or service-worker cache versions disagree, trust `package.json` first and report the mismatch instead of guessing.

## Test Credentials And Local Secrets

- If EventGenix CRM test credentials are required for live-site QA, load them locally from:
  `C:\Users\Plotva\.eventgenix\codex-crm-secrets.ps1`
- It is acceptable to tell the agent: "підхопи EventGenix CRM secrets з C:\Users\Plotva\.eventgenix\codex-crm-secrets.ps1".
- Never commit this file.
- Never copy secrets into repo files, docs, migrations, tests, screenshots, PR descriptions, logs, terminal output, or chat responses.
- Never print secret values in terminal output, logs, Markdown, PR descriptions, screenshots, or final summaries.
- If the file is unavailable, mark live-site QA as blocked instead of inventing credentials.
- Do not add shared/default user passwords to code, migrations, docs, tests, or examples.

## Database And Migrations

- Startup currently runs a two-phase DB flow: `initDatabase()`, then `runMigrations(pool)`, then `initDatabase()` again.
- Before schema work, inspect both `db/index.js` and `db/migrations/`.
- Prefer explicit SQL migrations for durable schema changes.
- Follow `DB_MIGRATION_GOVERNANCE.md` for migration ownership, metadata, data-fix, and cleanup rules.
- Run `npm run check:migrations` after adding or renaming migration files.
- New migrations numbered `162_*.sql` or higher must include `MIGRATION_KIND`, `SAFETY`, and `ROLLBACK` headers; destructive or date-scoped migrations need the extra headers documented in `DB_MIGRATION_GOVERNANCE.md`.
- Do not run destructive migrations or data cleanup without explicit user approval.
- If generated or seeded data is involved, identify the source-of-truth script or migration before editing output.
- First-user bootstrap must be explicit through `BOOTSTRAP_CREATOR_*` env vars. Local-only seed requires `ALLOW_DEV_USER_SEED=true` and `DEV_SEED_ADMIN_PASSWORD`; it must remain blocked in production-like environments.
- Legacy startup code must not reset existing `users.password_hash` values. Use authenticated user-management or an operator-run script for intentional rotation.

## Shared UI, Auth, And Navigation

- Shared access/navigation state is split across:
  - `middleware/auth.js` server `PAGE_ACCESS`
  - `js/auth.js` frontend `PAGE_ACCESS`
  - `js/components/sidebar.js` `NAV_ITEMS` and `SIDEBAR_ACCESS`
- When changing pages, roles, navigation, or access rules, inspect all three areas and keep them consistent.
- Do not change auth, roles, permissions, or access boundaries without explicit user approval unless the user task explicitly asks for that exact change.
- Preserve existing loading, error, empty, disabled, focus, keyboard, and ARIA behavior when touching shared UI.
- Prefer existing helpers and patterns in `js/ui.js`, `js/api.js`, `js/auth.js`, and `js/components/sidebar.js`.
- Do not replace shared UI patterns with one-off behavior unless the surrounding code already does that.

## Booking Detail Source-Of-Truth Guard

- Booking detail modal ownership is protected: `#bookingModal` and `#bookingDetails` are rendered by the canonical booking modules, primarily `js/booking.js`, with supporting renderers in `js/booking-banquet-detail.js` and `js/booking-package-renderer.js`.
- Do not add or keep an alternate booking details renderer in `js/timeline.js` or another non-booking module. Timeline code may call `showBookingDetails(...)` and collect diagnostics, but it must not write its own booking details markup.
- Booking identity, linked booking, timeline placement, activity display, and detail source fields are protected contracts: `id`, `linkedTo`, `linked_to`, `lineId`, `line_id`, `resourceId`, `resource_id`, `date`, `time`, `duration`, `room`, `status`, `programId`, `program_id`, `programName`, `program_name`, `programCode`, `program_code`, `label`, `/api/bookings/detail/:id`, `apiGetBookingById(...)`, `resolveBookingDetailsRecord(...)`, and `showBookingDetails(...)`.
- Changing those field priorities, endpoint sources, DB mapping, or modal ownership requires explicit user approval before code edits, even if the change appears to be a fallback or diagnostic fix.
- If canonical booking details fail to open, fix the canonical path or add a guarded diagnostic. Do not ship a parallel recovery UI unless the user explicitly approves that product behavior.
- `npm run check:timeline-protected-surface` hashes critical source blocks listed in `config/timelineProtectedSurface.js` and documented in `docs/TIMELINE_PROTECTED_SURFACE.md`. If one of those blocks changes, update the manifest only with explicit approval and a new focused regression test.

## Testing Expectations

- Preferred verification model for normal product work: CI + targeted live-site QA.
- Do not create separate local-test tasks by default.
- Do not block normal delivery on local test runs unless the user explicitly asks, CI is failing, or the bug cannot be diagnosed from CI/live-site behavior.
- GitHub Actions runs `npm test` on push and pull request; treat CI as the normal automated gate.
- Use targeted QA for the changed product area:
  - booking changes: verify booking creation/edit/detail/timeline behavior on the live site;
  - calendar or schedule changes: verify the relevant date/resource views;
  - client changes: verify client create/edit/search/detail flows;
  - auth/navigation changes: verify affected roles and visible/blocked pages;
  - reporting/dashboard changes: verify the changed widgets, filters, and empty/error states.
- For live-site QA, use the deployed CRM environment and test credentials loaded locally from the EventGenix CRM secrets file.
- Live-site QA must use only test accounts and safe test records.
- Do not create, edit, delete, invoice, charge, message, export, or otherwise affect real customer/production business data unless the user explicitly asks for that exact action.
- If a QA scenario requires production-like data, prefer read-only inspection first and report what needs explicit approval.
- If PostgreSQL-backed behavior changes and CI is insufficient, use live-site QA first; use `npm run test:api` or `npm run test:integration` only when needed to diagnose or verify a risky backend issue.
- If local verification is skipped, report it clearly in the final summary.

## Task Planning Style

- When asked to improve, rewrite, or strengthen tasks, act as a task amplifier, not as a generator of a huge plan from scratch.
- Use existing chat context and current Codex tasks first.
- Default to 3-6 task cards.
- Use more than 6 tasks only for genuinely complex work touching database, auth, billing, protected booking/timeline flow, production config, external integrations, or broad cross-module changes.
- Maximum 8 task cards unless the user explicitly asks for a deeper breakdown.
- Prefer merging micro-steps into larger practical task cards.
- Keep task cards copyable in separate Markdown blocks when the user asks for Codex-ready tasks.
- Each task card should include: Goal, Scope, Steps, Done when, Live-site QA, and Notes/Risks.
- Replace large "Bonus Audit Task" plans with a compact `Final sanity pass` unless the change is high-risk.
- Use deep audit only for database, auth, billing, protected booking/timeline flow, production config, or broad cross-module work.
- Do not ask clarifying questions if a safe assumption can be made. Ask only when proceeding could break database, auth, billing, protected booking/timeline flow, production config, production secrets, or Railway settings.
- Write task planning output in Ukrainian unless the user asks otherwise.
- Explain owner-facing risks in plain language suitable for a non-programmer product owner.

## Documentation Sources

- `README.md` is the human entrypoint.
- `docs/archive/` contains useful history from older Claude/OpenClaw workflows, including `CLAUDE.md`, `PROJECT_HANDOFF.md`, `PROJECT_PASSPORT.md`, `SNAPSHOT.md`, and `OPENCLAW_INTEGRATION.md`. These files are not current operating authority.
- Treat old task, handoff, and audit files as evidence, not authority.
- If docs conflict with code or `package.json`, document the conflict and prefer current repo evidence.
