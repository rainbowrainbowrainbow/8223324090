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
- `css/`: 25 files, shared UI and page-specific styling.
- `tests/`: 84 files, mixed unit, route smoke, UI smoke, and live API tests.
- `db/migrations/`: 159 migrations, with documented legacy duplicate/gap debt.
- `landing/`: public landing materials and static assets.

Large files that should not be casually reformatted:

- `js/chat-page.js`
- `css/chat.css`
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

### 3. Safety Net Before Deletion

Goal: make dead-code removal measurable before deleting files.

What to do:

- Keep `tests/static-cleanup.test.js` as the root media and landing redirect
  guard.
- Keep `tests/static-doc-guard.test.js` as the accidental public-doc exposure
  guard.
- Extend `tests/route-smoke.test.js` when public/protected boundaries change.
- Add focused tests before deleting or redirecting any page, asset, or API
  alias.

What this gives:

- Turns cleanup into repeatable verification instead of manual browsing only.
- Catches regressions where legacy URLs, redirects, or static files drift.
- Lets old files be removed with confidence.

Status: existing guards present; expand per pack.

### 4. Security And Deploy-Risk Cleanup

Goal: remove risks that can affect production even when product UI looks fine.

What to do:

- Keep runtime pinned to Node 22/npm 10 and verify with `check:runtime`.
- Continue tightening public endpoint allowlists and rate limits.
- Restrict query-token auth to explicitly approved download/export routes.
- Keep bootstrap credentials explicit through environment variables only.
- Audit local upload fallback behavior against Railway persistence.
- Keep service worker cache behavior away from private or stale API data.

What this gives:

- Reduces production-only failures and credential leakage risk.
- Makes Railway deploy behavior match local test behavior.
- Prevents cleanup from re-opening old auth/storage/cache problems.

Status: partially addressed by previous packs; query-token/storage/cache remain
high-value review areas.

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

### 6. Static Frontend Cleanup

Goal: reduce root HTML, JS, and CSS sprawl without changing user workflows.

What to do:

- Classify each root HTML file as live, redirected legacy, embedded, public, or
  deletion candidate.
- Avoid broad CSS rewrites; prefer page-scoped removals with visual checks.
- Split large JS only when a stable domain boundary already exists.
- Keep shared helpers in `js/ui.js`, `js/api.js`, `js/auth.js`, and
  `js/components/sidebar.js` consistent.

What this gives:

- Makes the static frontend easier to reason about.
- Reduces duplicate styling and script drift.
- Avoids breaking standalone pages that depend on shared globals.

Status: open.

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
| P1 | Query-token auth restriction | Reduces JWT leakage through URLs | `tests/auth-boundary.test.js`, `tests/route-smoke.test.js` |
| P1 | Upload storage inventory | Clarifies Railway persistence risk | `tests/chat-upload-storage.test.js`, `tests/audio-storage.test.js` |
| P1 | Root HTML ownership map | Prevents accidental live page deletion | `npm run cleanup:inventory`, `npm run test:ui` |
| P1 | Access/sidebar drift expansion | Keeps UI and backend permission rules aligned | `npm run check:access` |
| P2 | Scheduler side-effect map | Finds duplicate-prone background jobs | scheduler-focused tests |
| P2 | DB startup ownership slice | Reduces `initDatabase()`/migration split-brain | `npm run check:migrations` |
| P2 | Old root markdown archive pass | Reduces stale instruction risk | `tests/static-doc-guard.test.js` |
| P3 | Large CSS consolidation | Reduces UI drift | `npm run test:ui` plus browser smoke |

## Open Questions To Resolve Before Destructive Cleanup

- Which Railway branch/environment is the production deploy source?
- Which root HTML pages are intentionally public entrypoints?
- Which uploaded file categories must survive app redeploys?
- Which historical planning docs should remain at repo root for humans?
- Which DB seed/bootstrap responsibilities are still required for fresh
  customer environments?
