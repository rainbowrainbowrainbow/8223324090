# Event Genix CRM - системний аудит проблем перед великим Codex-етапом

Дата аудиту: 2026-05-11  
Гілка: `claude/check-project-version-f2QmG`  
Поточна версія: `43.13.0`  
Production Railway service: `8223324090`  
Останній перевірений Railway deployment: `904247f8-2952-49e1-84e2-a87785c15e2d` / `SUCCESS`

Цей документ є діагностичним handoff-звітом. Він не є списком готових задач, але написаний так, щоб інший агент міг швидко перетворити його на окремі task prompts.

> Update after audit (2026-05-11): runtime baseline work started after this report. Current intended baseline is Node.js `22.x` / npm `10.x`, pinned in repo config and guarded by `npm run check:runtime`. The original runtime mismatch findings below remain as audit evidence until a Railway deploy confirms build logs no longer use Node 18.

## 1. Executive Summary

Event Genix зараз працює і production відповідає `v43.13.0`, але система вже має характер великого монолітного CRM без достатнього safety-net. Головна небезпека для наступного етапу не в одному багу, а в тому, що зміни легко зачеплять shared auth, shared UI, DB migrations, service worker cache, Telegram callbacks, chat uploads або scheduler side effects.

Найкритичніші проблеми:

1. **Runtime mismatch:** локально тестувалось на Node `v24.13.0`, Railway будує на Node `v18.20.8`, але частина dependency tree вимагає Node `>=20`. Railway build вже показує багато `EBADENGINE`.
2. **Публічний landing demo endpoint фактично закритий auth middleware:** `POST /api/landing/demo-request` визначений як public lead endpoint, але production повертає `401`.
3. **Hardcoded default credentials у `db/index.js`:** у коді є реальні seeded passwords (`admin/admin123`, `Sergey232`, тощо) і reset/upsert логіка.
4. **Access rules дублюються у кількох місцях:** `middleware/auth.js`, `js/auth.js`, `js/components/sidebar.js`, `config/roles.js`.
5. **JWT query-token дозволений глобально для будь-якого protected API endpoint:** це зручно для `window.open`, але ризиково для leakage через URL/logs/referrers.
6. **Uploads зберігаються в локальному filesystem (`uploads/chat`, `uploads/designs`, `uploads/sounds`) без явного Railway volume для service:** ризик втрати файлів при redeploy/restart.
7. **DB schema control роздвоєний:** `db/index.js` створює/міняє schema на startup, а `db/migrations/` має 153 SQL-файли; є duplicate number `026`, пропуски номерів, destructive data migrations.
8. **Service Worker кешує API GET майже всього CRM:** для фінансів/chat/HR це може створювати stale/private-data ризики; offline mutation queue не має достатньої перевірки.
9. **Telegram callback flows частково залишаються single-use only by convention:** попередньо виправлені contractor/report-bot, але `routes/telegram.js` ще має багато callback paths, де потрібен окремий аудит idempotency/markup cleanup.
10. **Verification baseline став кращим, але все ще вузький:** `npm test` проходить, проте більшість API tests потребують live server/DB і не є частиною fast baseline; CI відсутній.

## 2. Current Baseline Evidence

### Git / deploy

- `git status --short --branch`: clean, branch synced with origin.
- Production health:
  - `GET /api/health`: `version=43.13.0`, `database=connected`, `status=ok`, `userCount=19`.
  - `GET /api/version`: `{"version":"43.13.0","name":"Event Genix","testMode":false}`.
- Railway service status:
  - service `8223324090`
  - deployment `904247f8-2952-49e1-84e2-a87785c15e2d`
  - status `SUCCESS`

### Verification run

Command run:

```bash
npm test
```

Result: pass.

What passed:

- `npm run check:version`: all version refs synced to `43.13.0`.
- `npm run check:syntax`: 258 JS files parse.
- `npm run test:unit`: 13 `sqlSafe` tests pass.
- `npm run test:ui`: 106 jsdom static/UI checks pass.

Important limitation: this is not full product coverage. It does not start the app, does not hit PostgreSQL, and does not exercise most mounted routes.

### Runtime versions

- Local:
  - Node `v24.13.0`
  - npm `11.6.2`
- Railway build logs:
  - Node `v18.20.8`
  - npm `10.8.2`
  - many `npm warn EBADENGINE Unsupported engine` warnings for dependencies requiring Node 20+.

## 3. Architecture Map

### Runtime shape

- Entrypoint: `server.js`.
- Backend: Express routes in `routes/`.
- Business logic/services: `services/`.
- DB: raw `pg` pool in `db/index.js`, migrations in `db/migrations/`.
- Frontend: root-level HTML pages + vanilla JS in `js/` + CSS in `css/`.
- Production: Railway service `8223324090`, PostgreSQL separate service.

### Scale snapshot

- `routes/`: 76 JS files, about 1.6 MB.
- `services/`: 43 JS files, about 0.8 MB.
- `js/`: 53 JS files, about 2.38 MB.
- root HTML pages: 35 files, about 1.57 MB.
- `db/migrations/`: 153 SQL files.
- `css/`: 25 files, about 0.9 MB.

Largest code hotspots by line count:

- `js/chat-page.js`: 7072 lines.
- `services/guardian.js`: 3540 lines.
- `js/settings.js`: 3227 lines.
- `js/center-page.js`: 2468 lines.
- `js/timeline.js`: 2314 lines.
- `services/scheduler.js`: 2253 lines.
- `routes/chat.js`: 2230 lines.
- `js/booking.js`: 2111 lines.
- `routes/hr.js`: 2038 lines.
- `js/hr-page.js`: 1875 lines.
- `js/copilot-page.js`: 1846 lines.
- `js/ui.js`: 1733 lines.
- `js/auth.js`: 1581 lines.
- `routes/finance.js`: 1539 lines.

### Major active subsystems

Confirmed active from `server.js` route mounts and production health:

- Auth/users/roles
- Booking timeline and booking automation
- Products/programs/catalogs/graduation catalogs
- Tasks/task templates/points/gamification
- Staff/HR/checkin/payroll-ish flows
- Finance/reports/report-bot/personal accounts
- Customers/leads/sales funnel/loyalty
- Dashboard/analytics/stats/alerts
- Chat/messenger/WebSocket/Guardian/Kleshnya
- Warehouse/procurement/music/sound/designs/content/marketing/omni
- Telegram bot, report bot, schedulers, outbox/event bus

Likely active but needs product-owner confirmation:

- Public landing site and `/api/landing/demo-request`
- Checkin/face descriptor flow
- Sound/music TTS generation
- AI/Guardian/Kleshnya/OpenClaw bridge
- Business cards and marketing-agent social publishing
- Game/quiz/room/shop/profile gamification

Ambiguous or likely stale/supporting:

- `SNAPSHOT.md`, `PROJECT_HANDOFF.md`, `PROJECT_PASSPORT.md`, `CLAUDE.md` contain useful history but are stale/conflicting.
- `manager-guide.html`, `sales-deck.html`, older plan/audit markdowns may be docs/assets, not live CRM flows.
- Duplicate root banner/slide assets vs `images/branding`/`images/banners` need cleanup audit before deleting.

## 4. Critical Problem Register

### P0/P1 - Fix before heavy feature work

#### 4.1 Runtime mismatch: Railway Node 18 vs dependency tree Node 20+

Evidence:

- `package.json` says `"engines": { "node": ">=18.0.0" }`.
- Local verification ran on Node `v24.13.0`.
- Railway build used Node `v18.20.8`.
- Railway build logged `EBADENGINE` for `@supabase/supabase-js`, `jsdom`, `undici`, `whatwg-url`, `data-urls`, `lru-cache`, and other packages requiring Node 20+.

Risk:

- Code can pass locally but fail or behave differently in production.
- Future dependency install may become hard failure if npm config changes.
- Tests using `jsdom@29` are not representative of Railway Node 18.

Recommended task group:

- Decide canonical runtime: likely Node 20 LTS or newer.
- Pin with `engines.node`, `.node-version` or Railway/Nixpacks config.
- Re-run Railway deploy and local verification using same Node major.
- Document runtime in `README.md`/`AGENTS.md`.

#### 4.2 Public landing request endpoint is blocked by auth

Evidence:

- `routes/landing.js` defines `POST /api/landing/demo-request` as demo/lead request endpoint.
- Global auth whitelist in `server.js` does not include `/landing/demo-request`.
- Production test without auth returned `401`.
- `GET /api/status/public` returns `200`, so public whitelist works for other explicit paths.

Risk:

- Public landing cannot collect demo requests.
- Marketing/lead capture can silently fail while static landing appears fine.

Recommended task group:

- Add explicit public allowlist for `POST /api/landing/demo-request`.
- Add a no-auth test for that route.
- Decide whether it should create a CRM lead, Telegram notification only, or both.
- Add rate limit / spam guard for public landing posts.

#### 4.3 Hardcoded seeded credentials and password reset logic

Evidence:

- `db/index.js` contains default user credentials such as `admin/admin123`, `Sergey232`, `Dasha743`, etc.
- There is an upsert/reset path (`007_upsert_users_v12_5`) that can update passwords.
- Historical docs also publish test credentials.

Risk:

- Known credentials can exist in production.
- Startup/schema code can reset accounts unexpectedly.
- Future agents may use real user credentials as test fixtures.

Recommended task group:

- Audit production users and rotate any seeded/default passwords.
- Separate test seed credentials from production boot path.
- Make default user seeding opt-in for local/dev only.
- Add startup guard preventing password reset migrations in production without explicit env flag.

#### 4.4 Access and role rules are duplicated

Evidence:

- Server access: `middleware/auth.js` has `ROLE_HIERARCHY`, `PAGE_ACCESS`, `ACTION_PERMISSIONS`.
- Frontend page access: `js/auth.js` duplicates role hierarchy and `PAGE_ACCESS`.
- Sidebar access: `js/components/sidebar.js` has `NAV_ITEMS` and `SIDEBAR_ACCESS`.
- Task role config: `config/roles.js` has `ROLE_PERMISSIONS`, `ROLE_DEPARTMENTS`, `DEFAULT_WIDGETS`.

Risk:

- A page can be visible in UI but blocked server-side, or hidden but accessible by URL/API.
- Role changes require edits in several places.
- Codex can easily fix one layer and miss another.

Recommended task group:

- Create a role/access source-of-truth strategy.
- At minimum, add tests comparing server `PAGE_ACCESS`, frontend `PAGE_ACCESS`, and sidebar access keys.
- Eventually move shared role/page metadata to generated JSON or one JS config consumed by both sides.

#### 4.5 JWT accepted through query string globally

Evidence:

- In `server.js`, if no `Authorization` header exists and `req.query.token` is present, it sets `Authorization: Bearer <token>` for any protected API request.
- This was added for proposal/print endpoints opened via `window.open`, but it applies broadly.

Risk:

- JWTs in URLs leak via browser history, server logs, analytics, screenshots, referrer headers, shared links.
- Any protected GET endpoint can be accessed via tokenized URL.

Recommended task group:

- Restrict query-token auth to explicitly listed download/proposal endpoints.
- Prefer short-lived one-time tokens for exports/proposals.
- Add tests proving generic protected routes do not accept `?token=`.

#### 4.6 Upload persistence is unsafe for Railway-style deploys

Evidence:

- `server.js` serves `/uploads` from local filesystem.
- `routes/chat.js` stores uploaded chat files in `uploads/chat`.
- `routes/designs.js` stores design uploads in `uploads/designs`.
- `routes/music.js` stores uploaded sounds in `uploads/sounds`.
- `.gitignore` ignores `uploads/designs/` and `uploads/sounds/`.
- Railway service list shows Postgres volume, but no obvious app service volume in current evidence.
- Separate `imageStorage.js` / `audioStorage.js` upload generated assets to Supabase, so there are two storage models.

Risk:

- User-uploaded files may disappear on redeploy/restart/container replacement.
- DB can point to files that no longer exist.
- Backups likely do not include uploaded binaries.

Recommended task group:

- Decide canonical storage for chat/designs/sounds: Supabase Storage, Railway volume, or S3-compatible bucket.
- Migrate existing file references.
- Add upload/download tests.
- Add health check that detects missing files for recent DB records.

#### 4.7 DB schema management is split between startup init and migrations

Evidence:

- `server.js` startup runs `initDatabase()`, then `runMigrations(pool)`, then `initDatabase()` again.
- `db/index.js` is about 70 KB and contains many `CREATE TABLE`, `ALTER TABLE`, indexes, seed data, and default users.
- `db/migrations/` has 153 files.
- Migration numbers have duplicate `026` and missing `55-59`, `69-70`, `84-85`.
- Several migrations are data-cleanup/date-specific (`147_clean_march_30_31.sql`, `142_task_cleanup_lifecycle.sql`, schedule-specific migrations).

Risk:

- Schema truth is unclear: startup code vs migrations.
- Data migrations can retry or behave differently over time.
- New agents may patch `db/index.js` instead of proper migrations.
- Destructive cleanup can run in unexpected environments.

Recommended task group:

- Declare migration source-of-truth.
- Freeze or minimize `initDatabase()` to base bootstrap only.
- Audit destructive migrations and mark environment/date assumptions.
- Add migration ordering/duplicate-number check.
- Add local migration dry-run or ephemeral DB verification.

#### 4.8 Service Worker caching/offline behavior is too broad for a CRM

Evidence:

- `sw.js` caches API GET requests network-first, except only `/api/auth/`, `/api/telegram/`, `/api/backup/`.
- Finance, chat, HR, customers, reports, and dashboard API GET responses can be cached.
- Offline mutation handling posts request body and selected headers back to all clients for queueing.

Risk:

- Sensitive/private CRM data can be served stale or stored in browser cache.
- Finance/report/chat data may be visible after logout or role change.
- Offline replay may duplicate writes if endpoints are not idempotent.

Recommended task group:

- Reclassify cache policy by data sensitivity.
- Disable API caching for finance/chat/HR/customers/reports/auth-adjacent endpoints.
- Add SW tests or manual verification checklist.
- Add logout cache-clear behavior.

#### 4.9 Telegram callback idempotency is only partially fixed

Evidence:

- Contractor callbacks and report-bot callbacks were fixed in current branch.
- `routes/telegram.js` still handles many inline callback types: `add_anim`, `no_anim`, `task_confirm`, `task_done`, `task_reject`, training approvals, review rating, pulse, order approve/reject.
- Some paths update state conditionally, but stale callback handling and old inline keyboard cleanup are inconsistent.

Risk:

- Repeated taps can still create duplicate ratings, pulse entries, task transitions, or order actions.
- UI may leave old buttons active.

Recommended task group:

- Audit every Telegram callback path as single-use vs multi-use.
- Add shared helper for answer/edit/clear keyboard.
- Add tests for stale/double taps per callback category.

## 5. High-Risk Structural Hotspots

### Chat / messenger / Guardian

Files:

- `js/chat-page.js` - 7072 lines.
- `routes/chat.js` - 2230 lines.
- `services/chatService.js` - 1018 lines.
- `services/guardian.js` - 3540 lines.
- `services/websocket.js` - active live-sync.

Risks:

- Largest frontend file in repo.
- Mixes messaging, uploads, WebSocket, push notifications, Guardian reports, notes/tasks, mutes, summaries.
- Upload persistence risk is directly in chat.
- Many inline render paths and `innerHTML`.

Suggested future audit:

- Split chat into bounded concerns only after behavior tests exist.
- First add tests/manual flows: send message, upload file, unread count, channel membership, Guardian action, WebSocket reconnect.

### HR / staff / payroll / checkin

Files:

- `routes/hr.js` - 2038 lines.
- `js/hr-page.js` - 1875 lines.
- `routes/staff.js`, `js/staff-page.js`.
- migrations `132`, `139-150`, `159-160`.

Risks:

- Real staff/schedule data mixed with historical cleanup migrations.
- Payroll/depremium additions are recent and likely sensitive.
- Role access must be precise.
- Bulk account creation and credential PDF export need security review.

### Booking timeline / scheduling / automation

Files:

- `routes/bookings.js`
- `js/booking.js`
- `js/timeline.js`
- `services/bookingAutomation.js`
- `services/scheduler.js`
- Telegram bot routes/services

Risks:

- Central operational workflow.
- Many linked booking/line/status side effects.
- Timeline drag/drop and conflict logic are fragile.
- Schedulers run many checks every minute.

### Finance / reports / report-bot

Files:

- `routes/finance.js`
- `js/finance-page.js`
- `routes/reports.js`
- `js/reports-page.js`
- `routes/report-bot.js`
- `services/report-bot.js`

Risks:

- Money/accounting data.
- Bot-to-CRM API key endpoints are public from global auth perspective but protected by custom key/Telegram secret.
- Report bot writes both `finance_transactions` and legacy `reports`.
- Personal/corporate routing needs data integrity tests.

### Frontend shared UI

Evidence:

- Static scan counted about 795 `innerHTML =` assignments and 439 inline `onclick=` occurrences across repo-owned code.
- Many page modules manually implement their own `apiRequest`, token retrieval, empty/error/loading states.

Risks:

- XSS and broken escaping if any untrusted DB field renders into HTML.
- Hard to preserve loading/error/disabled/accessibility states.
- UI behavior diverges across pages.

Recommended direction:

- Do not do one giant rewrite.
- Start with shared escaping/render helpers and tests around the highest-risk pages: chat, customers, finance, reports, tasks, booking.

## 6. Verification / Tooling Gaps

Current commands are honest but shallow:

- `npm test`: fast baseline only, passes.
- `npm run test:api`: live app/DB required.
- `npm run test:integration`: live app/DB required and broad.
- No GitHub Actions.
- No lint.
- No TypeScript.
- No coverage report.
- No migration dry-run.
- No browser end-to-end workflow tests.
- No automated Railway deploy verification.

Mounted route coverage signal:

- `server.js` mounts 76 route modules.
- A same-ish filename test scan found 42 with obvious corresponding tests and 34 without obvious same-name tests.
- This is not exact coverage, but it shows many active routes are not directly represented in test naming.

Suggested verification hardening:

1. Add GitHub Actions for `npm ci`, `npm test`.
2. Align CI Node with production Node after runtime decision.
3. Add optional integration job with PostgreSQL service.
4. Add route smoke tests for auth boundaries and public endpoints.
5. Add migration numbering check.
6. Add Playwright smoke only for top flows after runtime/CI is stable.

## 7. Dependency / Security Findings

`npm audit --json` reports:

- 7 vulnerabilities total:
  - 3 high
  - 3 moderate
  - 1 low
- Direct vulnerable packages include:
  - `multer`
  - `express-rate-limit`
- Transitive issues include:
  - `path-to-regexp`
  - `minimatch`
  - `brace-expansion`
  - `qs`
  - `ip-address`

`npm outdated --json` reports notable updates:

- `@anthropic-ai/sdk`: `0.75.0` -> `0.95.1`
- `@supabase/supabase-js`: `2.98.0` -> `2.105.4`
- `express`: current `4.22.1`, latest `5.2.1`
- `express-rate-limit`: `8.3.1` -> `8.5.1`
- `multer`: `2.0.2` -> `2.1.1`
- `pg`: `8.18.0` -> `8.20.0`
- `ws`: `8.19.0` -> `8.20.0`
- `jsdom`: `29.0.1` -> `29.1.1`

Important: do not run broad upgrades casually. First fix/pin runtime. Then update the small security set with focused tests.

## 8. API / Auth Boundary Findings

Global auth whitelist in `server.js` includes:

- `/auth/*`
- `/health`
- `/version`
- `/telegram/webhook`
- `/report-bot/*`
- `/personal-accounts/*`
- Kleshnya webhook/pending/sync endpoints
- demo login/scenarios
- `/packages`
- `/status/public`
- lead webhooks and `POST /leads/landing`

Concerns:

- `/report-bot/*` bypasses JWT entirely and relies on custom API key/Telegram secret inside route. This may be valid, but should be documented and tested.
- `/personal-accounts/*` bypasses JWT globally. Need confirm every endpoint has its own guard.
- `/landing/demo-request` is missing from public whitelist and currently broken.
- Query-token JWT fallback applies to all protected API routes.

Recommended task:

- Build an auth-boundary test suite:
  - public endpoints return expected status without auth;
  - protected endpoints reject no-auth;
  - bot endpoints reject missing/wrong custom secret;
  - query-token only works where explicitly allowed.

## 9. Storage / File Handling Findings

Local uploads:

- Chat: `uploads/chat`.
- Designs: `uploads/designs`.
- Sounds: `uploads/sounds`.

Remote/Supabase uploads:

- Generated catalog images: `services/imageStorage.js`.
- Generated audio: `services/audioStorage.js`.

Issues:

- Storage strategy is split.
- Manual uploads depend on local disk.
- Generated assets go to Supabase if configured, otherwise fallback to original temp URL.
- Multer audit has high vulnerabilities and uploads are high-risk by nature.
- Some file filters are extension-based; MIME/content validation should be checked.

Suggested task:

- Storage audit and migration plan, no code first.
- Then migrate one upload class at a time.

## 10. Database / Migration Findings

Migrations:

- 153 files.
- Max numeric prefix: 161.
- Duplicate prefix: `026`.
- Missing prefixes: `55-59`, `69-70`, `84-85`.

Startup:

- `server.js` runs `initDatabase()` twice around `runMigrations(pool)`.
- `db/index.js` both bootstraps schema and mutates schema/seed data.

Dangerous/data-specific migrations found:

- Staff/schedule cleanup and real-date schedule changes around migrations `139-150`.
- `142_task_cleanup_lifecycle.sql` deletes tasks matching specific titles and archives/deletes old data.
- `147_clean_march_30_31.sql` deletes schedule rows for fixed dates.
- Several `UPDATE staff SET is_active=false` type migrations.

This does not mean they are wrong. It means they are not safe to treat as generic schema migrations without context.

Suggested task:

- Produce DB migration governance:
  - schema-only vs data-fix migrations;
  - production-only data migrations require explicit approval;
  - migration lint for duplicate numbers;
  - no destructive SQL without documented rollback/backup.

## 11. Frontend Findings

### Token inconsistency

Most frontend uses `pzp_token`, but legacy files still read/write `token`:

- `center.html`
- `checkin.html`
- `js/booking-form.js`
- `js/booking.js`
- `js/content-page.js` has fallback to both.

Risk:

- Some pages/actions can fail auth depending on login path.
- Users can appear logged in on one page and broken on another.

### Rendering / XSS surface

Static scan:

- about 795 `innerHTML =` assignments.
- about 439 inline `onclick=` occurrences.

Risk:

- Escaping is likely inconsistent.
- Inline handlers make event lifecycle and accessibility harder.
- Broad refactors would be risky; incremental hardening is better.

### Shared UI state

Loading/error/empty/disabled states are implemented separately on many pages. Future changes should avoid breaking:

- modal closing/focus handling,
- disabled submit states,
- mobile/iOS touch targets,
- sidebar role filtering,
- empty/error states.

## 12. Docs / Process Findings

Recently improved:

- `AGENTS.md` exists and is operational.
- `README.md` is useful and documents commands/version/deploy boundaries.
- Version sync is now enforced by `scripts/version-sync.js`.

Still stale/conflicting:

- `SNAPSHOT.md` says v40.4/v40.5 era.
- `PROJECT_PASSPORT.md` says production branch `deployed`.
- `PROJECT_HANDOFF.md` says another Claude branch is production.
- `CLAUDE.md` has stale test counts and old deploy instructions.

Risk:

- Future agents can follow stale docs and deploy/push wrong branches.
- Test expectations in old docs do not match current scripts.

Suggested task:

- Archive or mark old docs as historical at top.
- Create one current operational doc for deployment branch/Railway service.
- Document current Railway deploy method: `railway up` to service `8223324090` vs branch auto-deploy, after owner confirms preferred workflow.

## 13. Active vs Stale Area Map

### Confirmed active

- `server.js`
- `package.json`, `package-lock.json`
- `AGENTS.md`, `README.md`, `CHANGELOG.md`
- `db/index.js`, `db/migrate.js`, `db/migrations/`
- most `routes/` mounted in `server.js`
- major root pages served by explicit static routes
- `sw.js`
- `services/scheduler.js`, `services/telegram.js`, `services/report-bot.js`, `services/websocket.js`

### Likely active

- `landing/` site, but demo API currently blocked.
- `checkin.html` and checkin-related HR/staff flows.
- `sound.html`, `routes/music.js`, `routes/sound-library.js`.
- `lib/marketing-agent.js` and social publishers if env vars are configured.
- `services/kleshnya-*`, `services/guardian.js`, AI/OpenRouter/Anthropic flows.

### Ambiguous

- `manager-guide.html`, `sales-deck.html`, some guide/deck assets.
- historical plan files: `PLAN_*`, `TASK-*`, `IMPROVEMENT_PLAN.md`, `ROADMAP.md`.
- old OpenClaw docs vs current Codex workflow.

### Likely stale or historical docs

- `SNAPSHOT.md`
- `PROJECT_HANDOFF.md`
- portions of `PROJECT_PASSPORT.md`
- portions of `CLAUDE.md`

Do not delete without confirmation; mark/archive first.

## 14. Suggested Work Packages For Another Agent

These are task groups, not implementation instructions.

### Group A - Runtime and deployment baseline

Goal:

- Make local, CI, and Railway use one Node/npm baseline.

Scope:

- Pin Node 20+ if chosen.
- Add `.node-version` or Railway config.
- Verify Railway build no longer emits `EBADENGINE`.
- Document exact deploy command and service.

### Group B - Auth boundary and public endpoint fixes

Goal:

- Make public/private API behavior explicit and tested.

Scope:

- Fix `/api/landing/demo-request` 401.
- Restrict query-token auth.
- Test public endpoints, protected endpoints, bot secret endpoints.

### Group C - Credentials and production seed safety

Goal:

- Remove known default-password risk.

Scope:

- Audit `db/index.js` user seed/reset logic.
- Make default seeds dev-only.
- Rotate production credentials.
- Update tests to create isolated test users without real defaults.

### Group D - DB migration governance

Goal:

- Stop schema drift and risky data migrations.

Scope:

- Add migration numbering check.
- Document schema/data migration rules.
- Audit destructive migrations.
- Decide `initDatabase()` future role.

### Group E - Storage persistence plan

Goal:

- Ensure user uploads survive deploys.

Scope:

- Inventory uploads and DB references.
- Choose Supabase/Railway volume/S3.
- Migrate chat/designs/sounds one by one.
- Add missing-file health check.

### Group F - Verification and CI hardening

Goal:

- Make future Codex changes automatically checkable.

Scope:

- Add GitHub Actions `npm ci && npm test`.
- Add optional PostgreSQL integration job.
- Add route auth-boundary tests.
- Add migration duplicate-number check.

### Group G - Telegram callback idempotency audit

Goal:

- Make all single-use inline Telegram flows safe.

Scope:

- Audit `routes/telegram.js` callback paths.
- Add tests for stale/repeated callbacks.
- Clear/rewrite inline keyboards after final selection.

### Group H - Chat/messenger stabilization

Goal:

- Reduce risk in the largest module.

Scope:

- Add behavior tests/manual checklist first.
- Split upload/message/guardian/reaction concerns only after coverage exists.
- Fix storage persistence dependency.

### Group I - Service Worker/cache policy

Goal:

- Stop stale/private CRM data leakage.

Scope:

- Reclassify API cache rules.
- Disable caching for sensitive modules.
- Clear caches on logout/version bump.
- Add SW/manual tests.

### Group J - Frontend token and rendering safety

Goal:

- Reduce auth inconsistencies and XSS risk.

Scope:

- Normalize `token` vs `pzp_token`.
- Add shared safe render patterns.
- Start with high-risk pages: chat, finance, customers, reports, booking.

### Group K - Dependency security update

Goal:

- Reduce known vulnerabilities safely.

Scope:

- After runtime pin, update `multer`, `express-rate-limit`, and safe transitive fixes.
- Run focused upload/rate-limit tests.
- Avoid Express 5 migration in same task.

### Group L - Docs cleanup

Goal:

- Make old docs safe as history.

Scope:

- Mark stale docs at top.
- Create current deploy/runbook doc.
- Keep `AGENTS.md`/`README.md` as current source.

## 15. Recommended Priority Order

1. Runtime/deploy baseline: Node/Railway mismatch.
2. Auth boundary: public landing 401 + query-token restriction.
3. Credentials/seed safety.
4. Storage persistence plan.
5. DB migration governance.
6. CI/verification expansion.
7. Telegram callback idempotency full audit.
8. Service Worker sensitive cache policy.
9. Chat/HR/Finance module-specific stabilization.
10. Frontend token/rendering cleanup.

## 16. Blocking Questions For Serhiy

1. Should Railway production continue to be deployed by `railway up` from the current workspace, or should there be an official production branch?
2. Should the canonical runtime be Node 20 LTS, Node 22 LTS, or current local Node 24?
3. Are default users/passwords still needed for production, or can they become local/test-only?
4. Which storage target should be canonical for uploaded chat/design/sound files: Supabase Storage, Railway volume, or another bucket?
5. Is the public landing expected to create CRM leads, Telegram messages, or both?
6. Should Service Worker offline API caching remain enabled for CRM data, or should it be restricted to static shell only?

## 17. Final Assessment

The project is usable and production is currently healthy, but it is not yet safe for a large uncontrolled stream of feature work. The next phase should first stabilize runtime, auth boundaries, credentials, DB migration discipline, storage persistence, and CI. After that, product work can be split by module without every change risking production.

The biggest practical rule for future agents: do not patch one visible screen only. In this repo, a visible issue usually crosses at least one route, one service, one DB table/migration, one frontend module, shared auth/navigation rules, version/changelog, and sometimes Telegram/scheduler/cache side effects.
