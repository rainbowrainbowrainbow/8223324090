# Event Genix CRM - Codex Working Rules

These rules are the current repository authority for Codex and other coding agents.
Keep them short and operational. Historical handoffs in `docs/archive/` are evidence,
not authority.

## Project Baseline

- Node.js `22.x`, npm `10.x`, Express, PostgreSQL through raw `pg`, static HTML/CSS/JavaScript.
- Runtime entrypoint: `server.js`.
- Main areas: `routes/`, `services/`, `middleware/`, `db/`, `js/`, and root static pages.
- Canonical package/version source: `package.json`.
- Use English for code, identifiers, commits, and technical documentation. Use Ukrainian for owner-facing progress, warnings, release notes, and final summaries.

## Instruction And Runbook Loading

- Read this file before changing the repository.
- Read `docs/CODEX_PRODUCTION_AUTONOMY.md` before any production release, migration, production data-fix, or live-site QA task.
- Read `DB_MIGRATION_GOVERNANCE.md` before schema or data migration work.
- Read `docs/TIMELINE_PROTECTED_SURFACE.md` before touching protected timeline/booking contracts.
- More specific nested `AGENTS.md` instructions override this file for their directory.

## Autonomy Policy

### Green - continue without confirmation

Green work includes:

- reading code, configuration, tests, logs, production status, and public/live version metadata;
- scoped edits in a clean worktree;
- targeted tests and `npm test`;
- commits on a feature/release branch explicitly placed in scope;
- read-only GitHub CI, Railway status, `/api/version`, and browser QA;
- scoped fixes for failing tests;
- preparation of a release manifest;
- screenshots that contain no secrets or real-customer sensitive data.

For Green work, send at most a short `УВАГА · LOCAL BLOCK` update and continue.
Do not wait for a reply.

### Yellow - one bounded authorization envelope

Yellow work includes:

- push to the production branch;
- additive/idempotent schema or bounded data-fix migrations;
- Railway deploy through the repository release helper;
- creation of disposable QA records;
- exact cleanup of registry-owned records from the approved QA run;
- at most three scoped hotfix release cycles inside the same authorization block.

A Yellow authorization is valid only:

- in the same task;
- for the named branch, production service, action scope, and data boundaries;
- for no longer than six hours;
- for no more than three release attempts.

The authorization may be present in the current request or supplied as the exact
named block confirmation. Once supplied, do not ask again while all envelope
boundaries still match. Managed policy or tool approval may still require a
platform-level review; never treat auto-review as broader permission.

### Red - always require separate explicit approval

Red work includes:

- mutation of real customer, booking, staff, finance, payroll, or operational records;
- broad or unscoped delete/cleanup;
- authentication, authorization, roles, permissions, or sessions;
- payments, invoices, billing, or payroll;
- production secrets or environment variables;
- Railway/GitHub project, service, environment, or deployment settings;
- force-push, destructive rollback, dropping data, or rewriting shared history;
- changing the protected booking contract or protected-surface manifest.

Stop with an exact blocker before a Red action, even when a Yellow envelope exists.

## Warning Format

Before every Yellow or Red block, show:

```text
УВАГА · <BLOCK-ID>

Дія: <одне речення>.

Наслідки:
1. <коротко>
2. <коротко>
3. <коротко>
4. <коротко>
5. <коротко>

Межі: <які дані/сервіси дозволені>.
Відкат: <rollback path>.
Потрібний дозвіл: «Дозволяю блок <BLOCK-ID>».
```

Do not fragment one production release into repeated approval questions.

## Before Editing

- Run `git status --short --branch`.
- Inspect relevant diffs and nearby implementation/tests before editing.
- Do not overwrite, revert, stash, delete, or reformat changes you did not make.
- If the main checkout is dirty, use a clean isolated worktree from the correct upstream branch.
- Keep unrelated changes out of the task diff.
- Prefer minimal changes that follow existing project patterns.
- Do not add dependencies or lockfile churn unless explicitly approved and required.

## Runtime And Core Commands

- Canonical runtime: Node `22.x`, npm `10.x`.
- Verify runtime: `npm run check:runtime`.
- Fast repository baseline: `npm test`.
- Full local baseline when explicitly needed: `npm run verify`.
- Syntax: `npm run check:syntax`.
- Unit tests: `npm run test:unit`.
- UI smoke: `npm run test:ui`.
- Migration governance: `npm run check:migrations`.
- Timeline/booking protected surface: `npm run check:timeline-protected-surface`.
- Focused test: `node --test tests/<file>.test.js`.
- If the host runtime is wrong, use:
  `npx -y -p node@22 -p npm@10 -c "<command>"`.

Do not report Node 18 or Node 24 verification as representative.

## Delivery

The normal delivery path is:

`implement -> commit -> push -> exact-SHA CI -> deploy -> live-site QA`

- If the user explicitly asks to deliver/release/deploy/ship end-to-end, proceed through the authorized stages without repeated confirmation.
- Production-write stages still require a valid Yellow envelope; Red actions are never implied.
- Diagnose failed CI before deployment.
- Do not claim checks ran when they did not.
- Do not commit, push, create a PR, or deploy unless the current request or active authorization includes that stage.
- Production auto-deploy is disabled; use only the documented manual release helper.

## Production Boundaries

- Canonical production branch: `codex/eventgenix-production`; verify it and live `/api/version` before every release or rollback.
- Production Railway service ID: `8223324090`; verify project/environment/service read-only before upload.
- Never run raw `railway up` from an unlinked worktree.
- Use `npm run release:railway-up` only within an authorized Yellow block.
- Never change Railway/GitHub settings or production secrets without Red approval.
- Follow `docs/CODEX_PRODUCTION_AUTONOMY.md` for CI, deploy, proof, migration, QA, retry, and rollback details.

## Database And Migrations

- Startup is `initDatabase() -> runMigrations(pool) -> initDatabase()`.
- Inspect `db/index.js`, `db/migrations/`, and migration governance before schema work.
- Prefer explicit durable SQL migrations.
- New migrations numbered `162_*.sql` or higher require `MIGRATION_KIND`, `SAFETY`, and `ROLLBACK` headers.
- Destructive/date-scoped migrations need the additional governance headers.
- Additive/idempotent work is Yellow; cleanup, destructive changes, unknown SQL, or real-data mutation is Red.
- Never use startup/bootstrap code to reset existing user passwords.

## Secrets And Live QA

- Load test credentials locally only from
  `C:\Users\Plotva\.eventgenix\codex-crm-secrets.ps1` when needed.
- Never print, commit, copy, screenshot, or persist secret values, database URLs, tokens, passwords, or customer PII.
- If the local secrets file is unavailable, report live QA as blocked.
- Live QA uses test accounts and disposable registered records only.
- Do not create, edit, delete, invoice, charge, message, export, or otherwise mutate real business data without exact Red approval.
- Exact cleanup may target only registry-owned disposable entities from the approved run.

## Protected Booking And Timeline Contract

- `#bookingModal` and `#bookingDetails` are owned by canonical booking modules, primarily `js/booking.js`, with supporting renderers in `js/booking-banquet-detail.js` and `js/booking-package-renderer.js`.
- Timeline code may call `showBookingDetails(...)`; it must not add an alternate booking-details renderer.
- Protected identity/detail fields and sources include:
  `id`, `linkedTo`, `linked_to`, `lineId`, `line_id`, `resourceId`,
  `resource_id`, `date`, `time`, `duration`, `room`, `status`,
  `programId`, `program_id`, `programName`, `program_name`,
  `programCode`, `program_code`, `label`,
  `/api/bookings/detail/:id`, `apiGetBookingById(...)`,
  `resolveBookingDetailsRecord(...)`, and `showBookingDetails(...)`.
- Changing field priorities, endpoint sources, DB mapping, modal ownership, or the protected manifest is Red.
- Fix the canonical path or add guarded diagnostics; do not ship a parallel recovery UI.

## Shared Auth, Access, And UI

- Shared page access/navigation is split across:
  - `middleware/auth.js` `PAGE_ACCESS`;
  - `js/auth.js` `PAGE_ACCESS`;
  - `js/components/sidebar.js` `NAV_ITEMS` and `SIDEBAR_ACCESS`.
- Auth/role/permission changes are Red unless the current request gives exact approval for that change.
- Preserve loading, error, empty, disabled, focus, keyboard, and ARIA behavior.
- Reuse `js/ui.js`, `js/api.js`, `js/auth.js`, and sidebar patterns before adding one-off UI behavior.

## Versioning

- `package.json` `version` and `eventGenix.releaseLabel` are canonical.
- Use `npm run version:current` before reporting the active version.
- For a release, keep functional and version/cache/changelog commits separate when practical.
- Canonical patch release: `npm run version:bump -- patch --label "<Release Label>"`.
- Synchronize generated version markers only when intentionally preparing a release.
- Documentation-only work normally does not need a version bump.
- Write user-visible changelog and release notes in Ukrainian.

## Verification And Final Report

- Run the smallest targeted checks first; use broader checks proportional to risk.
- CI is the normal automated gate after push. Local API/integration tests require a running PostgreSQL-backed app and are diagnostic tools, not automatic substitutes for live QA.
- CI keeps separate disposable PostgreSQL/browser jobs for HR/payroll and My Day, including the payroll profile/simultaneous-pay gate and `test:browser:my-day-actual-app:isolated`.
- After code changes, report:
  - implementation/root-cause decision;
  - changed files;
  - verification actually performed;
  - CI/deploy/live QA evidence when in scope;
  - remaining risks;
  - one recommended next action.

## Documentation Sources

- `README.md` is the human entrypoint.
- `docs/CODEX_PRODUCTION_AUTONOMY.md` is the operational production/migration/live-QA runbook.
- `DB_MIGRATION_GOVERNANCE.md` owns migration metadata and safety rules.
- `docs/TIMELINE_PROTECTED_SURFACE.md` owns the protected booking/timeline source contract.
- Trust current code and `package.json` over stale archived handoffs.
