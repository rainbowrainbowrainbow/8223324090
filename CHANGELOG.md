# CHANGELOG — Event Genix CRM

> Журнал змін. Останні версії зверху, детально. Старі — коротко внизу.

---

## v0.46.5 - Lead modal action buttons hardening (2026-05-13)

### Lead edit modal actions [codex]
- **Immediate binding** - lead modal controls now bind before async user/lead loading, so save/cancel cannot be skipped by a slow or failed data request.
- **iPad tap support** - the lead modal save and cancel buttons now handle touchend taps with duplicate synthetic-click protection.
- **Duplicate-save guard** - save disables while the lead update request is in flight to prevent repeated submissions.
- **Regression guard** - UI smoke checks now cover the edit modal action buttons and their touch binding.

---

## v0.46.4 - iPad Safari lead date row stack (2026-05-13)

### Lead modal iPad Safari fix [codex]
- **Touch WebKit fallback** - lead modal form rows now stack to one column on touch/WebKit devices.
- **Confirmed field fix** - the desired date and children count fields no longer share a row on iPad, preventing Safari native date-control paint overlap.
- **Customer-card safety** - customer-card form rows inherit the same iPad-safe layout behavior.
- **Regression guard** - UI smoke checks now assert the touch/WebKit row-stacking rules directly.

---

## v0.46.3 - Shared modal WebKit layout hardening (2026-05-13)

### Responsive modal forms [codex]
- **Adjacent modal hardening** - customer, finance, art-director, and Copilot two-column form rows now use shrink-safe grid tracks.
- **Native control bounds** - date, number, select, and text controls in those rows now stay within their grid columns on tablet WebKit layouts.
- **Regression coverage** - UI smoke checks now cover the additional modal form surfaces so future releases catch stale `1fr 1fr` regressions.
- **Browser sweep** - iPad-sized layout verification covers lead, customer-card, customer edit, transaction edit, and content edit modals.

---

## v0.46.2 - Lead modal iPad layout fix (2026-05-12)

### Leads responsive UI [codex]
- **iPad date field fix** - lead edit modal date inputs now stay inside their grid column instead of overlapping the children count field on tablet WebKit layouts.
- **Shared modal grid guard** - lead modal two-column rows now use shrink-safe grid tracks and form controls with explicit min/max widths.
- **Adjacent form coverage** - customer-card modal rows that reuse the same lead modal layout are covered by the same responsive fix.
- **UI smoke guard** - static UI checks now assert the lead/customer date and children fields plus the WebKit-safe grid rules.

---

## v0.46.1 - Guardian moderation repair tooling (2026-05-12)

### Guardian repair and reconciliation [codex]
- **Explain-first repair** - added a one-user Guardian moderation-state preview that compares durable event facts with derived `guardian_moderation_counters`.
- **Bounded apply path** - privileged operators can repair only missing or mismatched `repeat_offender` / `hourly_blocks` counter rows for one user at a time.
- **Safety guardrails** - stale/orphan counter rows are reported but not deleted automatically, keeping historical state changes explicit.
- **Ops console controls** - Guardian Ops includes a user-id repair panel with preview/apply actions, loading/error states, and issue explanations.
- **Audited recovery** - applied repairs write a Guardian ops audit record with issue and applied-row counts.

---

## v0.46.0 - Guardian delivery convergence (2026-05-12)

### Guardian reliability convergence [codex]
- **Explicit lifecycle states** - Guardian delivery events now distinguish delivered, duplicate no-op, retryable failure, terminal failure, replayed, and dead-letter outcomes.
- **Failure classification** - Telegram/director delivery paths classify malformed payloads, missing targets, missing configuration, provider rejection, and transient provider failures.
- **Dead-letter metadata** - `event_queue` and `event_dead_letter` store Guardian convergence status, failure class, attempts, idempotency key, terminal reason, and replay linkage.
- **Operator replay** - Guardian Ops now surfaces dead-lettered Guardian delivery events separately and allows one privileged single-event replay.
- **Focused tests** - added convergence, delivery classification, and ops replay coverage for retry, terminal, duplicate/no-op, and dead-letter behavior.

---

## v0.45.9 - Guardian ops console (2026-05-12)

### Guardian operator surface [codex]
- **Protected console** - added `/guardian-ops` as an internal operator page for Guardian reliability state.
- **Operational visibility** - console shows pending/failed Guardian outbox work, event-queue failures, active mutes, durable escalation counters, and recent Guardian actions.
- **Bounded recovery controls** - operators can requeue one Guardian outbox or failed event-queue item from the console without exposing bulk replay.
- **Access alignment** - backend page access, frontend access, and sidebar metadata now expose Guardian Ops only to creator/director/admin/security roles.
- **UI safety states** - added loading, empty, error, disabled, and live-region states for the operator surface.

---

## v0.45.8 - Guardian operator reliability controls (2026-05-12)

### Guardian reliability phase 3 [codex]
- **Operator snapshot** - added protected Guardian reliability inspection for pending/failed Guardian outbox events, event-queue failures, active mutes, recent actions, and durable moderation counters.
- **Bounded recovery** - operators can requeue one unpublished Guardian outbox row or one failed Guardian event-queue item without exposing bulk replay controls.
- **Permission boundary** - Guardian ops endpoints are limited to creator/director/admin/security roles and refuse non-Guardian recovery targets.
- **Audit trail** - requeue actions log a Guardian ops admin-audit entry with previous attempts/error context.
- **Focused tests** - added authz and recovery coverage for inspection, outbox requeue, event-queue requeue, and unsafe target rejection.

---

## v0.45.7 - Guardian durable moderation state (2026-05-12)

### Guardian reliability phase 2 [codex]
- **Durable counters** - repeat-offender and hourly-block escalation tracking now use database-backed moderation events and counters instead of module-scoped memory.
- **Replay safety** - Guardian mute events now record stable source identities so repeated processing of the same mute does not inflate escalation counters.
- **Escalation coupling** - repeat-offender and hourly-block Telegram alert requests are published from the same mute transaction when their durable thresholds are crossed.
- **Restart-safe baseline** - added focused tests for duplicate source suppression, rolling-window reset, and one-alert-per-window behavior.

---

## v0.45.6 - Guardian outbox-backed alert delivery foundation (2026-05-12)

### Guardian delivery reliability [codex]
- **Durable delivery envelope** - Guardian critical alert requests now use explicit outbox/event types for director DM and Telegram alert delivery.
- **Mute alert coupling** - successful Guardian mute claims publish director DM and Telegram escalation requests in the same transaction as `chat_mutes` and `guardian_actions`.
- **Action follow-up coupling** - `/api/guardian/action` warning follow-ups now enqueue director DM delivery inside the action transaction instead of relying on only a post-commit direct call.
- **Duplicate-safe processing** - director DM delivery uses stable delivery keys in message metadata to avoid duplicate user-visible alerts on retry.
- **Focused tests** - added mocked delivery coverage for enqueue semantics, duplicate suppression, provider failure, and Telegram request handling without live provider calls.

---

## v0.45.5 - Guardian single-use action controls (2026-05-12)

### Guardian stale-tap safety [codex]
- **Single-use controls** - Guardian DM action buttons now carry per-alert action tokens, so stale repeated taps are consumed at the server boundary.
- **UI contract** - the chat UI sends the action token with `/api/guardian/action` and still replaces the button group with the server result after completion.
- **Duplicate-safe fallback** - older clients without action tokens continue using the existing deterministic idempotency fallback.
- **Focused tests** - added coverage for consumed tokens, repeated taps, and separate alerts using separate tokens.

---

## v0.45.3 - Guardian mute/action idempotency (2026-05-12)

### Guardian integrity [codex]
- **Duplicate-safe auto mute** - Guardian mute creation now uses an advisory-lock transaction and skips duplicate side effects when an active channel/user mute already exists.
- **Single-use director actions** - repeated `/api/guardian/action` taps are claimed with deterministic idempotency keys before muting, warning, watching, or unmuting side effects run.
- **Scoped side-effect reduction** - duplicate mute rows, duplicate director action logs, duplicate director warning alerts, repeated trust penalties, and repeated heatmap updates are reduced in the covered flows.
- **Focused tests** - added helper and route coverage for repeated mute claims, rollback on action-log failure, stale `mute_both` taps, and duplicate director warning taps.

---

## v0.45.2 - Guardian director DM provisioning integrity (2026-05-11)

### Guardian DM provisioning [codex]
- **Atomic director DM** - Guardian/director DM creation now uses one transactional helper instead of separate check-then-insert paths.
- **Deterministic reuse** - provisioning reuses the stable `dm-guardian-director` slug and also preserves legacy DM channels that already connect Guardian and the director.
- **Atomic membership** - Guardian and director membership initialization commits in the same transaction as channel provisioning, with rollback on member setup failure.
- **Focused tests** - added deterministic coverage for repeated provisioning, legacy DM reuse, slug-shell repair, and rollback behavior.

---

## v0.45.1 - Guardian phase3 schema compatibility (2026-05-11)

### Guardian schema compatibility [codex]
- **Phase3 alignment** - Guardian service queries now use the column names defined by the phase3 migrations for mood, health, heatmap, weekly reports, escalation, and trust scores.
- **Compatibility migration** - added guarded schema support for `guardian_trust_history` and `guardian_escalation_config.updated_at` without deleting or rewriting production data.
- **Route fallback fix** - Guardian health fallback now reads current health from `guardian_channel_health` and history from `guardian_health_history`.
- **Focused guardrail** - added a static Guardian phase3 schema compatibility test so stale phantom-column patterns are caught in the fast unit baseline.

---

## v0.45.0 - Start of the 0.45 release line (2026-05-11)

### Versioning policy [codex]
- **New release train** - Event Genix now uses `0.45.x` as the active version line.
- **Canonical source** - `package.json` remains the version source of truth, with version-sync propagating the release to UI labels, cache-bust tags, and service-worker cache names.
- **Future mini updates** - follow-up releases should increment patch only as `0.45.1`, `0.45.2`, `0.45.3`, etc. until another explicit version-policy transition.
- **Historical lines** - `0.44.x` and older changelog entries remain historical references and are not active release markers.

---

## v0.44.17 - Booking and room chat provisioning integrity (2026-05-11)

### Chat channel provisioning [codex]
- **Atomic booking channels** - booking-linked chat channel provisioning now uses one transactional helper and deterministic slug conflict handling.
- **Atomic room channels** - room/line channel initialization now uses the same duplicate-safe provisioning pattern instead of check-then-insert.
- **Unique support** - added guarded partial unique index migration for active booking and room channels when production data is already duplicate-free.
- **Membership initialization** - newly provisioned booking/room channels initialize creator membership in the same transaction as channel creation.
- **Focused tests** - added coverage for repeated booking provisioning, deterministic slug conflict reuse, repeated room init, and membership initialization.

---

## v0.44.16 - Chat poll transactional writes (2026-05-11)

### Chat polls [codex]
- **Transactional poll creation** - poll message and `chat_polls` rows now commit or roll back together.
- **Locked vote updates** - voting now locks the poll row with `FOR UPDATE` before delete/insert/recount/update work.
- **Recount safety** - single-choice vote replacement and option vote counts are recalculated and stored inside the same transaction.
- **Rollback coverage** - focused tests prove poll creation rollback and vote replacement rollback do not leave split message/poll or vote/count state.

---

## v0.44.15 - Scheduled chat dispatch atomic claim (2026-05-11)

### Scheduled chat messages [codex]
- **Atomic claim** - due scheduled chat messages are now claimed with a transactional `FOR UPDATE SKIP LOCKED` update before dispatch.
- **Duplicate-send safety** - concurrent scheduler workers skip already claimed rows instead of selecting and sending the same message twice.
- **Failure semantics** - DB claim failures roll back so messages can retry; websocket broadcast failures after claim leave the message visible in DB and are not retried to avoid duplicate sends.
- **Focused tests** - added deterministic coverage for successful claim/broadcast, claim rollback, and post-claim broadcast failure behavior.

---

## v0.44.14 - Chat reminder idempotency (2026-05-11)

### Chat reminders [codex]
- **Stable source identity** - reminder-created tasks now use a deterministic `chat_reminder` `source_id` based on message, user, and canonical reminder time.
- **Duplicate-safe reminders** - repeating the same reminder request reuses the active task instead of creating a second task.
- **Transactional write path** - reminder task creation and task log creation now run in one DB transaction with an advisory lock.
- **No ambiguous fallback** - the old Kleshnya/direct-insert fallback path was removed for chat reminders, so partial failures roll back instead of creating duplicate follow-up work.
- **Focused tests** - added coverage for duplicate reminders, distinct reminder times, and rollback after simulated partial failure.

---

## v0.44.13 - Chat task authz and duplicate-safe creation (2026-05-11)

### Chat tasks [codex]
- **Update authorization** - chat-task status changes now require the assignee, creator, or an elevated chat-task manager role (`creator`, `director`, `admin`, `senior_manager`).
- **No broad task mutation** - unrelated authenticated users no longer update `chat_tasks` by id alone.
- **Duplicate-safe message tasks** - repeated task creation from the same chat message, title, creator, and assignee returns the existing active task instead of creating a duplicate.
- **Scoped repeatability** - channel-only tasks remain repeatable so legitimate recurring operational tasks are not blocked by title alone.
- **Focused tests** - added unit coverage for allow/deny update paths, elevated-role updates, duplicate message-task creation, and repeatable channel-only tasks.

---

## v0.44.12 - Guardian RBAC hardening for control routes (2026-05-11)

### Guardian authz [codex]
- **Exact-role guards** - Guardian admin/control routes now use explicit `creator` / `director` / `admin` role sets instead of generic authentication or legacy role expansion.
- **Owner-only controls** - channel Guardian toggles are limited to `creator` and `director`, while emergency stop is limited to `creator`.
- **Mute safety** - regular users can only see and clear their own active mute; Guardian admins can still view and manage all active mutes.
- **Command context** - `/api/guardian/command` now passes the authenticated user identity and exact admin flag into the Guardian command handler.
- **Focused tests** - added Guardian RBAC coverage for non-admin denial, admin allow, owner-only controls, self-unmute behavior, and command identity propagation.

---

## v0.44.11 - Chat upload durability and file safety (2026-05-11)

### Chat uploads [codex]
- **Durable storage path** - new chat uploads now prefer Supabase Storage bucket `chat-uploads` and store explicit provider/bucket/key/url metadata on the chat message.
- **Legacy fallback** - if Supabase is not configured or temporarily unavailable, uploads fall back to the existing `/uploads/chat` path so current chat attachment behavior remains usable.
- **File safety policy** - upload validation now rejects SVG and extension/MIME mismatches before storage or message creation.
- **Cleanup coverage** - deleting a chat message now removes the Supabase object when available, while preserving legacy local-file cleanup.
- **Focused tests** - added storage and route tests for Supabase metadata, local fallback, SVG rejection, MIME mismatch rejection, member upload success, and non-member denial.

---

## v0.44.10 - Chat poll authz and realtime broadcast fix (2026-05-11)

### Chat polls [codex]
- **Poll broadcast contract** - poll create/vote/close paths now call `broadcastToChannel(channelId, eventType, payload)` with explicit `chat:message`, `chat:poll-update`, and `chat:poll-closed` events.
- **Poll create realtime** - new poll messages are broadcast with the same `chat:message` contract as regular chat messages and use mapped message fields.
- **Poll authz coverage** - added focused tests for poll create, vote, results visibility, close, non-member denial, and realtime payload shape.
- **Client event bridge** - `js/ws.js` now forwards poll update/close events through the existing `ws:chat` channel for chat listeners.

---

## v0.44.9 - Root media cleanup and landing-page redirects (2026-05-11)

### Static asset cleanup [codex]
- **Duplicate root media removed** - exact duplicate banner/branding PNGs were removed from repo root; canonical copies remain under `images/banners/` and `images/branding/`.
- **Loose HTML resolved** - `sales-deck.html` now lives under `landing/sales-deck.html`, matching the existing landing manager guide pattern.
- **Legacy URL compatibility** - `/manager-guide`, `/manager-guide.html`, `/sales-deck`, and `/sales-deck.html` now 302 to canonical `landing/` pages instead of depending on loose root files.
- **Cleanup coverage** - added `tests/static-cleanup.test.js` and wired it into `test:unit` to catch duplicate root media returning or landing guide/deck routes drifting.

---

## v0.44.8 - Historical docs archive and static doc guard (2026-05-11)

### Docs/static exposure hardening [codex]
- **Historical archive** - moved stale Claude/OpenClaw handoff docs into `docs/archive/` and marked them as non-authoritative history.
- **Current docs clarified** - `README.md` and `AGENTS.md` now point to active sources of truth first and label archived docs as context only.
- **Static doc guard** - root static serving now blocks direct public access to root/archive `.md` and `.txt` docs while leaving intended HTML/assets and upload-style paths available.
- **Focused coverage** - added `tests/static-doc-guard.test.js` to prove README/archive docs and root `.txt` proofs are not publicly served through broad static middleware.

---

## v0.44.7 - Chat render safety tests and URL guards (2026-05-11)

### Chat render safety [codex]
- **Render test harness** - added focused jsdom coverage for `js/chat-page.js` message rendering helpers without initializing the full chat app.
- **Plain text and links** - tests now cover escaping for core message text, markdown/link formatting, and injected tag payloads.
- **Bot content** - tests lock down the limited safe bot tags while keeping injected HTML escaped.
- **File and preview surfaces** - attachment names, unsafe attachment URLs, and link-preview metadata now have explicit XSS regression coverage.
- **Attribute safety** - chat escaping now also encodes quotes, preventing user text from breaking out of HTML attributes.
- **URL guard** - file, GIF, voice, and link-preview renderers now strip unsafe non-http/non-relative URLs such as `javascript:`.

---

## v0.44.6 - Report-bot submit transaction and idempotency (2026-05-11)

### Finance/report integrity [codex]
- **Transactional submit** - `POST /api/report-bot/submit` now writes the submission queue row, finance transaction, and legacy report row in one DB transaction.
- **Duplicate guard** - submit uses a durable idempotency key from explicit request/raw payload IDs, with a stable payload fallback for repeat deliveries.
- **Rollback safety** - if the legacy report write fails after the finance write, the whole submit is rolled back instead of leaving split finance/report state.
- **Kyiv date** - the submit path now uses an explicit request date or Europe/Kyiv today instead of UTC-only `toISOString()` day slicing.
- **Focused coverage** - added tests for success, duplicate submit, and partial failure rollback.

---

## v0.44.5 - Atomic linked booking move/resize/shift (2026-05-11)

### Booking integrity [codex]
- **Atomic linked endpoint** - added `POST /api/bookings/:id/linked-atomic` so main + linked timeline updates commit together or roll back together.
- **Timeline drag/resize** - drag, cross-line move, resize, and their undo paths now use the atomic server path instead of serial linked `PUT`s.
- **Time shift undo/redo** - booking time shift, undo shift, and redo shift now update linked bookings in one bounded transaction.
- **Conflict rollback** - server-side conflict checks validate main and linked targets before any update, preventing partial linked-booking moves.
- **Focused coverage** - added self-contained tests for success, linked conflict rollback, and incomplete linked payload rejection.

---

## v0.44.4 - Route guard hardening for designs, music, reports, and chat (2026-05-11)

### Authz [codex]
- **Designs API guard** - `routes/designs.js` now requires the same manager-up/art-director/marketer access used by the design/art pages.
- **Music API guard** - `routes/music.js` now requires sound-page access instead of accepting any authenticated role.
- **Reports API guard** - `routes/reports.js` now matches the reports page matrix: creator/director/vice-director/senior-manager/accountant only.
- **Chat API guard** - `routes/chat.js` now blocks waiter-level users at the API boundary, aligned with `/chat` page access.
- **Focused coverage** - route smoke now covers allow/deny cases for designs, music, reports, and the actual chat router.

---

## v0.44.3 - Access source-of-truth and sidebar drift guard (2026-05-11)

### Access/Auth [codex]
- **Access drift check** - added `npm run check:access` and wired it into `npm test` to compare backend `PAGE_ACCESS`, frontend `PAGE_ACCESS`, sidebar access keys, and role metadata.
- **Unknown page deny** - frontend `canAccessPage()` now rejects unknown routes instead of allowing them by default, while normalizing hash/page aliases safely.
- **Sidebar reconciliation** - `/sales-funnel` and `/leads` share the same lead access; tasks/chat/Kleshnya/Afisha/Certificates no longer use broad sidebar `all` access where waiter should not see them.
- **Security role metadata** - added `security` to role permissions/departments/default widgets and shared role UI metadata.
- **Focused coverage** - route smoke checks security role exposure, `/sales-funnel` alias parity, and waiter exclusion from task page access.

---

## v0.44.2 - Dashboard auth and version-sync guardrails (2026-05-11)

### Dashboard/Auth [codex]
- **Analytics access** - `/api/analytics` now uses manager-up access, aligned with frontend/sidebar page access.
- **Widget backend guard** - `/api/dashboard/widgets/:type` enforces server-side role checks for sensitive widgets, and saved dashboard config filters unauthorized widgets.
- **Version sync guard** - `scripts/version-sync.js` checks dashboard first-screen version/changelog labels so dashboard-specific stale markers are caught.
- **Focused coverage** - route smoke covers analytics manager-up access and sensitive widget 403s; UI smoke checks dashboard labels against `package.json`.

---

## v0.44.1 - Sound storage pilot on Supabase Storage (2026-05-11)

### Storage [codex]
- **Manual sound uploads** - `/api/music/library/upload` now attempts to store new manual audio files in Supabase Storage under the `audio-library` bucket instead of relying first on Railway-local `uploads/sounds`.
- **Legacy fallback** - if Supabase is not configured or upload fails, the route falls back to the existing local `/uploads/sounds` behavior so operators are not blocked during rollout.
- **Explicit storage metadata** - added nullable `sounds.storage_provider`, `storage_bucket`, `storage_key`, `storage_url`, and `storage_migrated_at` fields for backfill-safe tracking and remote delete cleanup.
- **Delete cleanup** - sound deletion now removes Supabase objects when a storage key exists and still removes legacy local files for old records.
- **Focused coverage** - added `tests/audio-storage.test.js` and wired it into `npm run test:unit` / CI.
- **First screen** - updated the login version marker and "Що нового" entry for the sound storage pilot.

---

## v0.44.0 - Versioning convention transition to 0.44.x (2026-05-11)

### Version policy [codex]
- **Canonical version reset** - `package.json` now starts the active release train at `0.44.0`; `package-lock.json`, visible UI markers, asset cache-bust strings, service-worker cache names, and `/api/version` derive from that source.
- **Mini-update rule** - future small releases on this train must increment patch as `0.44.1`, `0.44.2`, `0.44.3`, and so on. Do not return to `43.x.x` or jump to `44.x.x` without an explicit version-policy task.
- **History preserved** - existing `v43.*` changelog entries, code comments, and migration notes remain historical references to earlier CRM work; they are not the active version source.
- **Version-sync discipline** - `scripts/version-sync.js` continues to enforce the single source of truth from `package.json` across package-lock, HTML asset tags, first-screen labels, latest changelog marker, service-worker cache names, and inline asset refs.
- **First screen** - updated the login version marker and "Що нового" entry for the new `0.44.x` line.

---

## v43.20.0 - Service Worker privacy cache and offline replay guardrails (2026-05-11)

### Client safety [codex]
- **API cache allowlist** - Service Worker now caches only public non-user-specific `/api/version` and `/api/status/public` GET responses; authenticated or sensitive API GETs are network-only.
- **Sensitive CRM exclusions** - finance, chat, HR, customers, reports, dashboard, analytics, leads, staff, tasks, bookings, warehouse, settings, auth-adjacent, and bot endpoints are explicitly classified as sensitive.
- **Logout cache clearing** - logout/token invalidation now clears `event-genix-api-*` caches and asks the Service Worker to clear private API caches plus the offline mutation DB.
- **Offline replay boundary** - generic offline mutation replay is disabled by default until a route is explicitly reviewed and allowlisted; private mutation bodies/auth headers are not queued broadly.
- **Focused coverage** - added `tests/service-worker-policy.test.js` and wired it into `npm run test:unit` / CI.
- **First screen** - updated the login version marker and "Що нового" entry for the Service Worker privacy cache release.

---

## v43.19.0 - Telegram callback idempotency and keyboard cleanup (2026-05-11)

### Bot flow safety [codex]
- **Callback classification** - audited Telegram callback families and treated animator, certificate use, task transitions, training approval/rejection, review rating, and auto-order decisions as single-use; kept `pulse:*` multi-use for shared group mood collection.
- **Keyboard cleanup** - completed single-use callbacks now clear or rewrite inline keyboards after success, and stale callbacks clear old buttons where the message can still be edited.
- **Task stale guard** - new task inline buttons include expected status tokens (`todo` / `in_progress`) so stale buttons from older task states cannot trigger conflicting transitions.
- **Decision idempotency** - training, review, and auto-order callbacks now check pending/duplicate state before creating side effects or sending contractor notifications.
- **Focused tests** - added `tests/telegram-callbacks.test.js` and wired it into `npm run test:unit` / CI to cover stale/double taps and the intentionally multi-use pulse path.
- **First screen** - updated the login version marker and "Що нового" entry for the Telegram callback safety release.

---

## v43.18.0 - CI baseline guardrails for push and pull requests (2026-05-11)

### Verification and CI [codex]
- **GitHub Actions baseline** - added `.github/workflows/ci.yml` for push and pull request verification.
- **Runtime alignment** - CI uses Node 22 from `.node-version`, aligns npm to `10.9.8`, installs with `npm ci`, and runs `npm test`.
- **Safety checks automated** - the CI gate now covers runtime drift, version sync, migration duplicate/gap/governance checks, JavaScript syntax, unit/auth-boundary smoke, and static UI smoke.
- **Honest scope documented** - README and AGENTS now state that CI does not replace PostgreSQL integration tests, live Railway health checks, browser automation, or manual UX/accessibility review.
- **First screen** - updated the login version marker and "Що нового" entry for the CI baseline release.

---

## v43.17.0 - DB migration governance and static migration guard (2026-05-11)

### Database governance [codex]
- **Migration check** - added `npm run check:migrations` to detect new duplicate migration numbers, undocumented numbering gaps, invalid future migration filenames, and missing safety metadata.
- **Governance rules** - added `DB_MIGRATION_GOVERNANCE.md` to document the current `initDatabase()` vs `db/migrations/` split and the intended source of truth for future schema changes.
- **Legacy baseline** - documented the existing duplicate `026_*` migration number, known numbering gaps, and risky legacy data/date/user migrations as controlled debt instead of a pattern to copy.
- **Verification baseline** - `npm test` now includes the migration governance check so future Codex work cannot quietly add unsafe schema/data migrations.
- **First screen** - updated the login version marker and "Що нового" entry for the database governance release.

---

## v43.16.0 - Credential seed guard and safe user bootstrap (2026-05-11)

### Security [codex]
- **Default credentials removed** - startup no longer seeds shared user passwords from code or silently resets existing `users.password_hash` values.
- **Explicit bootstrap** - fresh environments must use `BOOTSTRAP_CREATOR_*` env vars for the first creator; local-only dev seed requires `ALLOW_DEV_USER_SEED=true` plus `DEV_SEED_ADMIN_PASSWORD`.
- **Legacy seed guardrails** - v12.5 user upsert, Anna/Artem, and OpenClaw seed paths are marked without password updates; OpenClaw JWT login now requires `OPENCLAW_BOOTSTRAP_PASSWORD`.
- **Docs/tests cleaned** - removed published shared credentials from repo docs and examples; live API tests now require explicit `TEST_USER` and `TEST_PASS`.
- **Focused coverage** - added `tests/user-seed-policy.test.js` to lock the production/dev seed boundary.

---

## v43.15.0 - Auth boundary fix for public landing and query tokens (2026-05-11)

### Security and behavior [codex]
- **Public landing access** - `POST /api/landing/demo-request` and the active landing form path `POST /api/leads/landing` now bypass JWT auth intentionally instead of being blocked by the global API guard.
- **Query-token hardening** - global `?token=` JWT fallback is restricted to the approved graduation proposal/export `window.open` endpoints instead of every protected API route.
- **Boundary tests** - added focused tests for public endpoints, protected no-auth rejection, generic query-token rejection, allowed query-token paths, and report-bot/Telegram missing or wrong secrets.
- **Abuse guard** - added a burst limiter for public landing/demo lead submissions.

---

## v43.14.0 - Node 22 runtime and Railway baseline (2026-05-11)

### Platform baseline [codex]
- **Canonical runtime** - pinned Event Genix to Node `22.x` and npm `10.x` through `package.json`, `.nvmrc`, and `.node-version`.
- **Railway alignment** - documented that Railway/Nixpacks must use Node 22 and that any fallback to Node 18 or EBADENGINE warnings is a deploy-blocking runtime drift.
- **Verification guard** - added `npm run check:runtime` and made `npm test` run it before version, syntax, unit, and UI checks.
- **First screen** - updated the login version marker and "Що нового" entry for the runtime baseline release.

---

## v43.13.0 - Codex stabilization pack (2026-05-11)

### Stabilization [codex]
- **Repo rules** - added `AGENTS.md` and refreshed `README.md` with Codex-ready rules for dirty worktrees, deploy boundaries, version/changelog discipline, verification, and shared UI/access patterns.
- **Version source of truth** - aligned package, package-lock, visible UI version, cache-bust tags, service-worker cache names, changelog markers, and inline asset refs around `package.json`.
- **Verification baseline** - made `npm test` an honest fast local baseline and split live server/database checks into `test:api` and `test:integration`.
- **Telegram callbacks** - isolated and committed the single-use inline callback fix for contractor and report-bot choices.

---

## v43.12.0 - Codex version source-of-truth sync (2026-05-11)

### Versioning [codex]
- **Canonical version** - `package.json` and `package-lock.json` now carry `43.12.0`, matching the visible first-screen Codex test marker.
- **Cache/version sync** - asset `?v=` tags, service-worker cache names, and the public catalog CSS reference are aligned through `scripts/version-sync.js`.
- **Guardrail** - `scripts/version-sync.js` now checks package-lock, latest changelog markers, `sw.js`, standalone pages, and the inline catalog asset reference in `server.js`.

### Verification [codex]
- **Package scripts** - `npm test` now runs the fast local verification baseline via `npm run verify`.
- **Honest scopes** - unit/UI/version/syntax checks are separate from server+DB API and integration suites.
- **Syntax guard** - `scripts/check-js-syntax.js` adds a dependency-free Node parser check for repository JavaScript.

---

## v38.17.0 — Leaderboard + Daily Badge + Tasks Preview (2026-03-26)

### Profile Leaderboard [claude-code]
- **Seed data** — рейтинг заповнений для всіх юзерів (XP, coins, level)
- **Daily badge pulse** — CSS `badge-pulse` анімація на табі щоденних завдань
- **Tasks preview** — блок попереднього перегляду завдань на профілі
- **Migration 129 fixes** — ALTER TABLE daily_quests ADD all columns (IF NOT EXISTS)

---

## v38.16.0 — Profile Redesign: Hero, Inventory, Shop, Quests (2026-03-26)

### Profile Page [claude-code]
- **Hero glassmorphism** — картка профілю зі скляним ефектом, контрастні шрифти
- **Inventory** — RPG ячейки замінено на картковий вигляд (card layout)
- **Shop seed** — 17 items: кава 200₴, піца 800₴ + 6 їжі + 9 косметики
- **Quests seed** — 8 щоденних квестів у daily_quests таблиці
- **Кімната прибрано** — таб "Кімната" видалено з profile page

---

## v38.15.0 — Match-3 Enhanced Special Effects + Profile (2026-03-26)

### Match-3 Game [claude-code]
- **Спецефекти** — bomb, lightning, cross, rainbow анімації по центру клітинки
- **Клітинки** — фіолетовий тінт на білому фоні (light mode fix)
- **Profile API** — `/profile/:userId` повертає JSON замість redirect

---

## v38.14.0 — Каталоги: Image Picker + Premium Viewer (2026-03-26)

### Catalog UX [claude-code]
- **Image Picker** — 4 варіанти: AI генерація, upload, галерея, URL (замість prompt())
- **Premium Catalog Viewer** — 7 пакетів випускних з повноекранним переглядом
- **openCatalog fix** — виправлено infinite recursion (Maximum call stack)
- **submitCreateCatalog** — додано відсутню функцію створення каталогу
- **Graduation seed** — inline button styles + graduation catalog seed data

---

## v38.13.0 — Catalog Pages + Supabase Storage (2026-03-26)

### Catalog Pages [claude-code]
- **catalog_pages таблиця** — Migration 127: HTML-сторінки для каталогу (обкладинка + товарні)
- **API** — GET/POST/PUT/DELETE endpoints для сторінок каталогу
- **Fullscreen viewer** — ← → навігація, Escape закриття
- **Створення сторінок** — "+ Обкладинка" та "+ Сторінка" кнопки
- **Вставка зображень** — кнопка "🖼 Зображення" на кожній сторінці
- **Редагування** — назва, опис, ціна через "✏️ Редагувати"

### Supabase Storage [claude-code]
- **Постійне збереження** — AI зображення завантажуються в Supabase Storage (bucket: catalog-images)
- **Транслітерація filename** — UA→ASCII для Supabase (фікс "Invalid key" помилки)
- **Fallback** — якщо Supabase недоступний, зберігає Kie.ai temp URL
- **CSP** — дозволено img-src для *.supabase.co та *.aiquickdraw.com

### AI Image Generation [claude-code]
- **nano-banana-2** — оновлено модель (google/nano-banana → nano-banana-2)
- **Role access** — всі catalog endpoints дозволяють creator/director/art_director/manager
- **Error feedback** — toast на старті/успіху/помилці генерації

### CSS Architecture [claude-code]
- **css/designs.css** — 342 рядків витягнуто з designs.html
- **css/catalog.css** — 483 рядків + стилі catalog pages
- **designs.html** — 1541 → 725 рядків (-53%)

---

## v38.11.0 — Systematic Frontend Improvements (2026-03-26)

### AI Image Generation [claude-code]
- **Kie.ai prompt fix** — transliterate Ukrainian→English (Gemini rejected cyrillic)
- **Fallback save** — if apply-image fails, saves via PATCH directly
- **Error feedback** — toast on start/success/failure

### Centralized Notifications [claude-code]
- **js/notification.js** — single showNotification() with aria-live, replaces 9 duplicates
- **alert() → toast** — 16 alert() calls replaced across hr, sound, settings, warehouse

---

## v38.10.0 — Sidebar Active Fix + Catalog Improvements (2026-03-26)

### Sidebar [claude-code]
- **Active state rewritten** — exact match only, no startsWith. Fixes double-active (/art + /art-director, /designs + /designs#catalogs)
- **Hash logic** — hash items active only when URL hash matches; default first hash only when no non-hash sibling
- **Scroll restore** — saves/restores scroll position between page navigations

### Catalogs [claude-code]
- **"+ Створити каталог" button** — modal with name, emoji, description; POSTs to /api/catalogs/definitions
- **Viewer overflow fixed** — removed max-height:80vh that cut off catalog page content
- **Hash tab switching** — /designs#catalogs now switches tab BEFORE async loads
- **Null checks** — apiFetch responses checked before .json() (12 places fixed)
- **UI split** — "Готові каталоги" and "Каталоги товарів" sections
- **Price bug** — totalPerChild was string concatenation; fixed with parseFloat

### Match-3 Game [claude-code]
- **Special indicators** — 10→16px, dark bg, hover tooltip with label + description
- **Pause button** — ⏸ in header, overlay with blur, resume button
- **Bonus banner** — animated slide-across on special activation

---

## v38.9.0 — Stability & Page Fixes (2026-03-25)

### Critical Fixes [claude-code]
- **art-director-page.js, center-page.js, demo-page.js** — відновлено оригінальні файли (помилковий "fix" ламав initPage функції → сторінки Арт, Центр, Демо не працювали)
- **copilot-page.js** — додано `showAddInteractionForm` і `loadTrackerAlerts` до window.CopilotPage (кнопки в Менеджер AI не реагували)
- **designs.html** — видалено misplaced `<script>` тег всередині JS функції + fix openCatalog() race condition
- **server.js** — `/designs` тепер показує designs.html напряму (було 302 redirect на /art)

### Sidebar & CSS [claude-code]
- **Центр цін → Центр керування** 🎛️ (перейменовано в sidebar)
- **embed-mode CSS** — ховає sidebar/header в iframe (фікс дублювання sidebar в Звіти tab)

### Tooling [claude-code]
- **tests/ui-check.js** — 106 автоматичних DOM/JS перевірок через jsdom (синтаксис, структура, exports)
- **jsdom** додано як dev dependency

---

## v38.8.0 — Авто-каталог Fix + Dashboard Widget (2026-03-25)

### Catalog Fixes [claude-code]
- **Шрифти зменшено** — cover icon 56→40px, year 28→22px, title clamp(20,4vw,28)px, price clamp(18,3vw,24)px, h3 16→15px
- **Viewer overflow** — catalog-pages-container max-height: 80vh
- **Dashboard widget** — каталоги повернено до списку доступних dashboard віджетів

---

## v38.7.0 — Sidebar: Арт + Дизайнер Split (2026-03-25)

### Sidebar Restructure [claude-code]
- **Група "Продукт" розділена** на два окремих блоки:
  - **🎨 Арт** — Програми, Арт директор, Випускний, Афіша, Сертифікати (все пов'язане з розважальними програмами)
  - **📐 Дизайнер** — Дизайн-борд, Каталоги, Стайлгайд (все по дизайну та візуалу)
- **Каталоги переміщено** з `/art` → `/designs#catalogs` (де живе авто-каталог viewer з AI генерацією та PDF експортом)
- **data-page-group** оновлено: art-director/programs/graduation → `"art"`, designer/designs → `"designer"`
- **CSS page transitions** — окремі анімації для груп art (rotateIn) та designer (fadeScale)

---

## v38.6.0 — Business Logic Hardening + Full System Audit (2026-03-25)

### Booking System Hardening [claude-code]
- **Status whitelist** — тільки `confirmed`, `preliminary`, `cancelled` приймаються; будь-який інший рядок ігнорується
- **Cancelled→confirmed blocked** — скасоване бронювання не можна відновити, потрібно створити нове
- **Midnight span prevention** — бронювання не може перевищувати 00:00 (time + duration > 1440 хв = помилка)
- **mapBookingRow on payment** — `PATCH /:id/payment` тепер повертає camelCase замість raw snake_case

### Wallet Race Conditions Fixed [claude-code]
- **Transfer deadlock prevention** — lock обох wallets в порядку ID (менший перший) при переказах
- **Daily login idempotency** — подвійний guard: перевірка `last_login_reward` + перевірка `coin_transactions` за сьогодні

### Database Migration 126 [claude-code]
- **5 нових indexes** — `leads(assigned_to)`, `leads(status, created_at)`, `bookings(program_id)`, `finance_transactions(category_id)`, `staff(hire_date)`
- **FK ON DELETE** — `bookings.customer_id` і `discount_usage.customer_id` → `ON DELETE SET NULL`

### Frontend Fixes [claude-code]
- **setInterval cleanup** — agents-panel, alerts, status-page: `clearInterval` on `beforeunload`
- **innerHTML XSS** — escaped user data в hr-page, center-page, chat-page
- **CSS iOS zoom** — 3 inputs з font-size 13px → 16px (controls.css: timeline-search, night-settings, template-select)

### Code Cleanup [claude-code]
- **3 unused imports** видалено — `requireRole` з decisions.js, designs.js, points.js

### Testing [claude-code]
- **+11 нових тестів** (424 → 435): wallet (2), shop (3), minigame (3), booking validation (3)

### System Audit Findings (documented for next session) [claude-code]
- **29 route files** без dedicated тестів (wallet, shop, minigame, personal-accounts, recurring, chat та інші)
- **Server startup**: DATABASE_URL missing = тільки warning (має бути fatal)
- **Graceful shutdown**: не чекає in-flight requests перед закриттям DB pool
- **Stale data on reconnect**: після тривалого offline клієнт бачить суміш старих і нових даних
- **Response format inconsistency**: 4 формати pagination, 3 формати errors across routes

---

## v38.5.0 — Deep QA Sweep (2026-03-25)

### Security Hardening [claude-code]
- **Hardcoded API ключі видалено** — KIE.ai (2 місця) + OpenRouter: graceful 503 якщо env var не задано
- **SQL injection fix** — `routes/backup.js`: table name interpolation → `safeTableName()` з allowlist
- **Telegram HTML injection** — `esc()` для всіх user-controlled полів у notification templates (notes, names, descriptions)
- **IDOR fix** — `PATCH /bookings/:id/payment` додано `requireAction('edit_booking')`
- **innerHTML XSS** — escaped user data в hr-page, center-page, chat-page (4 місця)
- **10 missing PAGE_ACCESS** — додано auth записи для art-director, designs, game, leads, profile, quiz, report-agent, reports, room, shop

### Race Conditions Fixed [claude-code]
- **awardXP** — atomic SQL `xp = xp + $1` замість read-modify-write
- **purchaseShopItem** — `FOR UPDATE` lock на shop_items запобігає oversell
- **updateStreak** — atomic UPSERT з CASE логікою, без read-modify-write

### Performance [claude-code]
- **N+1 achievements** — 500+ queries → 9 parallel batch queries (Promise.all)
- **N+1 bulk messaging** — 1000 INSERTs → single batch INSERT
- **N+1 meeting action items** — loop INSERT → multi-row INSERT
- **52+ unbounded SELECT*** — додано LIMIT на всі queries без обмежень
- **Pagination caps** — chat limit=200, summary limit=100, days=365

### Frontend QA [claude-code]
- **401 blank screen fix** — 13 сторінок: `loginOverlay` → `window.location.href='/'`
- **434 buttons** — додано `type="button"` (запобігає accidental form submit)
- **Sidebar hash nav** — нормалізація pathname для in-page tab switching
- **Dark mode flash** — prevention script на 20 сторінках
- **Null-safe getElementById** — demo-page, art-director-page tab switching
- **setInterval leaks** — agents-panel, alerts, status-page: clearInterval on beforeunload
- **CSS iOS zoom** — 3 inputs з font-size 13px → 16px

### Timezone DST Fixes [claude-code]
- **music-delivery.js** — hardcoded UTC+3 → DST-aware `toLocaleString('en-US', { timeZone: 'Europe/Kyiv' })`
- **agentTracker.js** — hardcoded +02:00 → dynamic DST offset
- **8 toLocaleDateString()** — додано `timeZone: 'Europe/Kyiv'` (graduation, certificates, finance, bot, templates)

### Memory & Stability [claude-code]
- **Guardian.js** — periodic cleanup (5 хв) для 9 in-memory caches (запобігає ~20MB leak за 7 днів)
- **contextCache.js** — periodic cleanup (10 хв) + hard cap 500 entries
- **WebSocket heartbeat** — snapshot iteration запобігає iterator invalidation; `_removeClient()` для повного cleanup
- **unhandledRejection** — тепер `process.exit(1)` (запобігає corrupted state)
- **API 404** — JSON `{ error: 'Not found' }` замість HTML для `/api/*` routes

### Database [claude-code]
- **Migration 126** — 5 missing indexes (leads, bookings, finance, staff) + ON DELETE SET NULL для bookings.customer_id, discount_usage.customer_id

### Telegram [claude-code]
- **Message truncation** — `truncate()` helper для 4096 char Telegram limit
- **Silent catches** — 3 `.catch(() => {})` → logging (order notify, lead notify, chat ID reg)

### Testing [claude-code]
- **+78 нових тестів** (346 → 424): auth-refresh (15), sql-safety (13), decisions (11), vacancies (9), graduation (10), dashboard-widgets (10), our-fixes (10)

### Documentation [claude-code]
- **CHANGELOG.md** — відновлено 20+ пропущених версій (v35.1–v38.2)
- **PROJECT_PASSPORT.md** — v22.18 → v38.5, routes 61→74, services 30→41, CSS 17→22
- **SNAPSHOT.md** — оновлено architecture counts
- **Cache-bust** — `?v=38.5.0` на всіх 34 HTML сторінках
- **Accessibility** — aria-label на 11 inputs (analytics, customers, dashboard, art-director, chat, demo, center)

---

## v38.4.0 — Security & Reliability Hardening (2026-03-25)

### JWT Refresh Tokens [claude-code]
- **Refresh token rotation** — short-lived access tokens (15m) + long-lived refresh tokens (30d)
- **Replay detection** — reuse of revoked token automatically revokes ALL user sessions
- **Session management** — `/api/auth/sessions` endpoint to list active sessions
- **Logout** — `/api/auth/logout` revokes refresh token; `allDevices: true` revokes all
- **Backward compatible** — legacy 24h token still issued for existing clients
- **Auto-cleanup** — scheduler job removes expired/revoked tokens weekly

### Transactional Outbox [claude-code]
- **Outbox pattern** — `publishInTransaction()` writes events in the same DB transaction as business data
- **Outbox relay** — scheduler processes unpublished events every 5 seconds via `FOR UPDATE SKIP LOCKED`
- **Dual-write prevention** — eliminates risk of event loss when DB commits but event publish fails
- **Auto-cleanup** — published outbox events cleaned up after 7 days

### pg_stat_statements [claude-code]
- **Enabled** via migration — provides query performance statistics (planning time, execution time, calls)
- **Migration 125** — `refresh_tokens` table, `outbox_events` table, pg_stat_statements extension

### SQL Safety Utilities [claude-code]
- **`utils/sqlSafe.js`** — `safeOrderBy()`, `safeTableName()`, `safeSets()` helpers
- **Audit complete** — all 12+ dynamic SQL locations verified using allowlists (no actual injection vectors found)

---

## v38.3.0 — Operations Intelligence (2026-03-24)

### Exceptions Inbox [claude-code]
- **Новий dashboard віджет "Що потребує уваги"** — агрегує 6 типів операційних проблем:
  - 💥 Конфлікти кімнат (перекриття часу бронювань)
  - 🎭 Бронювання без аніматора
  - ⏰ Прострочена підготовка (event-задачі)
  - 😞 NPS детрактори (оцінка 1-2/5 без follow-up)
  - 🧹 Прибирання з перевищеним SLA
  - 🔴 Непідтверджені бронювання за <2 години до старту
- **Авто-додано** до дашбордів: creator, director, vice_director, senior_manager, manager, admin, reception

### Event Pipeline [claude-code]
- **Автоматичний lifecycle бронювання** через event bus:
  - `booking.t24` — за 24 години до події (нагадування + задача підготовки)
  - `booking.day_of` — в день події (чек-лист підготовки кімнати)
  - `booking.completed` — після завершення (тригер для прибирання)
- **booking_pipeline** таблиця — відстеження стадій кожного бронювання (idempotent)

### NPS Follow-Up Automation [claude-code]
- **Detractor follow-up** — при оцінці 1-2/5 автоматично:
  - Створюється high-priority задача менеджеру
  - Telegram-алерт директору
- **Promoter referral** — при оцінці 5/5 автоматично:
  - Telegram-повідомлення з пропозицією рекомендації
- Нові поля event_reviews: `nps_score`, `follow_up_status`, `follow_up_task_id`

### Cleaning Task Chain [claude-code]
- **cleaning_tasks** таблиця — автоматичне створення задач прибирання після завершення подій
- **SLA tracking** — дефолт 15 хвилин на прибирання, відстеження в exceptions inbox
- Прив'язка до кімнати та бронювання

### Event Bus Rules [claude-code]
- 5 нових default правил: `booking_t24_reminder`, `nps_detractor_followup`, `nps_promoter_referral`, `booking_cleaning_auto`, `booking_day_prep`
- Scheduler jobs: `checkEventPipeline` (5 хв), `checkNpsFollowUp` (hourly), `checkCleaningTasks` (5 хв)

---

## v38.2.0 — Тестовий деплой + Deep Research підготовка (2026-03-24)

### Research & Deploy [claude-code]
- **Deep Research** — підготовлено промпти для глибокого аналізу CRM (бізнес + технічний)
- **Тестовий деплой** — перевірка стабільності системи

---

## v38.1.0 — HR: Команда + Вакансії + Підбір персоналу (2026-03-22)

### Team Tab Fix [claude-code]
- **initTabs()** — null-safe panel lookup + loader object pattern
- **loadTeam()** — spinner, null-check для hrFetch, error states

### Roles Sync [claude-code]
- **ROLE_LABELS** — 7 → 15 ролей (+trampoline_instructor, waiter, bartender, cook, head_cook, director, vice_director, hr_manager)
- **teamRoleFilter** — optgroup структура (Керівництво/Аніматори/Кухня/Технічний)

### Vacancies Module [claude-code]
- **Migration 123** — `job_vacancies` + `job_applications` таблиці з індексами, тригер auto-update applications_count
- **routes/hr.js** — 8 нових ендпоінтів (vacancies CRUD, applications CRUD, hire з auto-staff creation)
- **hr.html** — новий таб "Вакансії" зі статус-фільтром, stat cards, канбан кандидатів

---

## v38.0.0 — Sound Module (2026-03-22)

### Sound Page [claude-code]
- **sound.html** — повний rewrite з 4 табами: Оголошення / Бібліотека / Плейлисти / Лог
- **Migration 122** — sounds.url column, extended category/type checks
- **routes/music.js** — POST /generate-tts (TTS), GET/POST/DELETE /library (file upload), GET/POST/DELETE /projects
- **js/sound-page.js** — логіка табів, API calls, модалки
- **css/sound.css** — Design System v4.0 токени, dark mode, мобільна адаптація

### v38.0.1 — Sidebar Fixes [claude-code]
- **Арт директор** — додано до окремої групи sidebar
- **Ukrainian labels** — локалізація sidebar меню

---

## v37.8.0 — Visual Polish (2026-03-22)

### UI Enhancement [claude-code]
- **Cards** — глибші тіні, hover-lift з border-glow
- **Buttons** — gradient backgrounds, glow-shadow, scale active
- **Inputs** — inset shadow, hover border, покращений focus ring
- **Login** — gradient кнопка, стильніші інпути, inner glow
- **Tooltip** — backdrop-blur, rounded 12px
- **Tabs/Filters** — gradient active, hover-lift
- **Dashboard** — widget hover-lift, stat-items gradient tint
- **Dark mode** — оновлено empty-state

---

## v37.7.0 — Page Transitions (2026-03-22)

### Animations [claude-code]
- **5 анімацій входу** — унікальна анімація для кожної групи sidebar (CRM, Управління, HR, Творче, Система)
- **Exit анімація** — 180ms fade-slide-down при навігації
- **prefers-reduced-motion** — вимикає всі переходи

---

## v37.6.0 — Sidebar Visual Upgrade (2026-03-22)

### Sidebar Redesign [claude-code]
- **Nav icons** — 28px rounded boxes з gray-50 background, colored on active
- **User card** — gradient card з border, shadow, 36px avatar
- **Active state** — gradient background + 4px glow indicator bar
- **Hover** — translateX(2px) slide animation
- **Custom scrollbar** — 4px thin (webkit + firefox)
- **Dark mode** — всі нові стилі адаптовано

---

## v37.5.0 — Cache Bust Fix (2026-03-22)

### Browser Cache [claude-code]
- **Проблема** — браузер кешував старі JS файли (config.js, sidebar.js) бо ?v= не змінився
- **Фікс** — оновлено ?v=37.5.0 на всіх 30 HTML сторінках

---

## v37.4.0 — Системний QA Чекап (2026-03-22)

### QA [claude-code]
- **Version bump** — 37.3.0 → 37.4.0
- **Changelog entry** — 13 пунктів всіх змін сесії
- **Cache-bust** — ?v=37.4.0 на всіх 30 HTML сторінках

---

## v37.3.0 — Sidebar Always Expanded (2026-03-22)

### UX Change [claude-code]
- **Collapse видалено** — display:none !important
- **Всі 5 груп відкриті** — defaultOpen: true (CRM, Управління, HR, Творче, Система)
- **localStorage очищено** — pzp_sidebar_collapsed + pzp_sidebar_groups removed on init

---

## v37.2.0 — HR Group in Sidebar (2026-03-22)

### Navigation [claude-code]
- **Нова 5-а група** — HR (🤝) з Графік, Команда, Кадри, Навчання
- **Навчання** — переміщено з CRM до HR групи
- **Управління** — залишено тільки бізнес-елементи (Клієнти, Ліди, Фінанси, Аналітика, Звіти, AI)

---

## v37.1.0 — Sidebar Responsive Fix (2026-03-22)

### Responsive [claude-code]
- **Root cause** — group labels з uppercase + letter-spacing:1.2px overflow 220px sidebar
- **layout.css** — letter-spacing 1.2→0.8px, text-overflow:ellipsis
- **Tablet (769-1023px)** — font 12px, group label 9px для 200px sidebar
- **Mobile (≤768px)** — accordion groups в collapsed off-canvas sidebar 280px

---

## v37.0.0 — UI Polish Bundle (2026-03-22)

### 7 Improvements [claude-code]
- **Profile** — null-safe getElementById для currentUser
- **Афіша** — 🎭 кнопка додана до timeline top-bar
- **Statistics** — приховано з dropdown menu
- **History** — видалено дублікат з dropdown (залишено тільки sidebar)
- **sound.html** — нова сторінка з Library/Projects/Upload табами
- **routes/sound-library.js** — CRUD API для звуків
- **designer.html** — нова сторінка з 5 табами (Catalogs, Guideline, Brand Book, Styleguide, Templates)

---

## v36.0.0 — Decision Screen (2026-03-22)

### Центр прийняття рішень [claude-code]
- **decisions.sql** — PostgreSQL таблиця з пріоритетами, джерелами, індексами
- **routes/decisions.js** — 4 ендпоінти: GET pending, POST create, PUT approve/reject/defer, GET history
- **js/decision-screen.js** — IIFE модуль з локальними утилітами, блокуючий overlay на Dashboard
- **css/decision-screen.css** — overlay z:99999, sticky header, card animations
- **Priority cards** — critical (red), important (yellow), normal (blue)
- **Dark mode** — повна підтримка

### v36.1.0 — Decision Screen for All Roles [claude-code]
- Зняте обмеження по ролях для /pending, /:id/:action, /history

### v36.2.0 — Seed Decisions [claude-code]
- **Migration 116** — 3 тестових рішення (critical/important/normal) для першого деплою

---

## v35.1.0–v35.11.0 — Sidebar Polish & Site Health (2026-03-22)

### Sidebar Improvements [claude-code]
- **v35.1.0** — чисті emoji іконки (прибрано gray badge box), додано /reports до Управління
- **v35.2.0** — compact nav-links (padding 10→7px, font 14→13px), smart defaultOpen (тільки активна група)
- **v35.3.0** — додано Каталоги до Творче групи, фікс user card onclick
- **v35.4.0** — видалено improvementFab (перекривав Клешню)
- **v35.5.0** — 🌙/☀️ theme toggle кнопка в sidebar

### API & Page Fixes [claude-code]
- **v35.6.0** — API bugfixes: copilot columns (updated_at→last_contact_at, full_name→name), warehouse route ordering
- **v35.7.0** — додано /copilot до PAGE_ACCESS в auth.js
- **v35.8.0** — unified sidebar на всіх 24 сторінках
- **v35.9.0** — фікс blank copilot page (auth flow broken — тепер робить свій apiVerifyToken)

### Site Health [claude-code]
- **v35.10.0** — CSS cache bust + Nunito font на всіх 27 сторінках
- **v35.11.0** — full site health fix: overlays, scripts, fonts, versions (0 remaining issues)

---

## v35.0.0 — Sidebar Full Rebuild (2026-03-22)

### Sidebar Accordion Groups [claude-code]
- **Accordion Navigation** — 4 групи (CRM, Управління, Творче, Система) з CSS grid-template-rows анімацією
- **Unified Nav** — однакове sidebar меню на всіх 24 сторінках замість різних hub-dropdown
- **Collapse Button** — `sidebarCollapseBtn` додано на всі 23 standalone сторінки
- **Nav Icons** — збільшено emoji розмір (15px → 17px collapsed), scale(1.08) анімація при hover

### Cross-Page Actions [claude-code]
- **Афіша/Сертифікати/Налаштування** — кнопки працюють з будь-якої сторінки через `?open=` auto-open
- **`sidebarOpen*` helpers** — якщо на таймлайні → модалка, якщо на іншій сторінці → redirect `/?open=`
- **`_checkAutoOpen()`** — app.js читає `?open=` параметр і відкриває панель після ініціалізації

### New Routes [claude-code]
- **`/afisha`** → redirect 302 → `/?open=afisha`
- **`/certificates`** → redirect 302 → `/?open=certificates`
- **`/designer`** → sendFile або redirect → `/art`
- **`/sound`** → sendFile або redirect → `/`
- **PAGE_ACCESS** — додано `/designer`, `/sound`, `/afisha`, `/certificates`

### Bugfixes (E1-E11) [claude-code]
- **E1** — `sidebar-group-inner { min-height: 0 }` для grid collapse анімації
- **E2/E6** — `#sidebarActions` приховано `display:none` (не видалено — app.js/auth.js мають обробники)
- **E3** — collapse button на всіх сторінках
- **E4/E5** — `showAfishaModal` / `openCertificatesPanel` graceful з redirect
- **E7** — `/staff` двічі → `noActive: true` на "Команді" запобігає подвійному підсвічуванню
- **E8** — collapsed sidebar: `.sidebar-group-items { display: none }`
- **E9** — спрощений onclick без зайвого `window.X` дублювання
- **E10** — collapsed nav-link padding override
- **E11** — `toggleGroup` додано в `return {}`

### Dark Mode [claude-code]
- Accordion стилі: border, hover, arrow, group icon, vertical track
- Nav icon active: `box-shadow: 0 2px 8px rgba(16,185,129,0.25)`

### Infrastructure [claude-code]
- **8 unclosed `<div>` tags** — виправлено в changelog секції index.html (v20.0.0 → v12.3.0)
- **346/346 тестів pass**, 0 fail
- **31 файл змінено**, 654 insertions, 310 deletions

---

## v32.0.0 — Premium Каталог Випускних (2026-03-16)
- **Premium Catalog Redesign** — повний редизайн каталогу випускних на рівні друкованих каталогів 2025 [claude-code]
- **Geometric Mosaic** — CSS полігональний фон з унікальною пастельною палітрою для кожного з 7 пакетів [claude-code]
- **Info Cards** — нова структура: "ВИПУСКНИЙ" label + назва великим текстом + іконки ⏱ тривалість / 👥 діти / ₴ ціна [claude-code]
- **Services Card** — кольоровий акцентний блок з переліком послуг UPPERCASE [claude-code]
- **Description Card** — детальні описи кожної послуги (catalog_description) з DB [claude-code]
- **Fullscreen Viewer** — immersive перегляд з sticky topbar, навігація ◀▶, Escape/Arrow/Swipe [claude-code]
- **7 Package Themes** — лавандовий (best-dj), золотий (super-party), блакитний (science), м'ятний (handmade), жовтий (pizza), червоний (squid-game), рожевий (neon) [claude-code]
- **Print A4** — 1 пакет = 1 сторінка, geometric mosaic зберігається при друку, компактна типографіка [claude-code]
- **Export** — повний каталог (обкладинка + 7 сторінок) з premium дизайном для друку/PDF [claude-code]
- **Share** — Web Share API + clipboard fallback для поширення пакету [claude-code]
- **DB Migration 086** — min_kids/max_kids для пакетів, catalog_description для послуг [claude-code]
- **automation.test.js fix** — 28 тестів виправлено: додано 'auto_complete' до valid task type filter [claude-code]
- **Version sync** — всі 360 cache-bust ?v= тегів синхронізовані [claude-code]
- **SNAPSHOT.md** — повне оновлення з v24.3 до v31.8 з актуальними метриками [claude-code]

## v30.3.0 — Пошук, Шаблони, Повтори (2026-03-14)
- **Пошук по таймлайну** — Ctrl+F відкриває search bar, підсвітка знайдених блоків, навігація ▲▼ по результатах, авто-скрол, dimming непотрібних блоків [claude-code]
- **Redo + Hotkeys** — Ctrl+Z скасувати, Ctrl+Shift+Z / Ctrl+Y повторити, повний redo стек (до 10 дій) [claude-code]
- **Шаблони бронювань** — DB таблиця `booking_templates`, CRUD API `/api/booking-templates`, dropdown + кнопка 💾 у формі бронювання, лічильник використань, сортування по popular+favorites [claude-code]
- **Повторювані бронювання UI** — модалка з вибором патерну (щотижня, через тиждень, будні, вихідні, щомісяця), дні тижня, дата завершення. Кнопка 🔄 в деталях бронювання [claude-code]
- **Bulk-операції** — Shift+Click для multi-select блоків на таймлайні, floating action bar (видалити, підтвердити, зробити попередніми) [claude-code]
- **PDF експорт** — кнопка "Друк PDF" з print stylesheet (ховає UI, зберігає кольори блоків) [claude-code]
- **Міграція 075** — `booking_templates` таблиця з індексами на favorite та usage_count [claude-code]

## v24.4.0 — QA Mega Fix + Adaptive Layout (2026-03-12)
- **8 сторінок виправлено** — додано відсутній ui.js (customers, chat, dashboard, leads, profile, shop, quiz, room) — confirmModal/showNotification були undefined [claude-code]
- **Адаптивний layout** — прибрано max-width обмеження (1800/1400/1200px), контент розтягується на повну ширину коли панель закрита [claude-code]
- **Smart hyperlinks** — в деталі бронювання: клікабельний tel:, Instagram, Telegram, CRM-картка клієнта з hover-actions [claude-code]
- **Copy-on-hover** — кнопки 📋 на рядках деталі бронювання + "Скопіювати все" [claude-code]
- **Sidebar gap fix** — прибрано візуальну дірку між навігацією і кнопками дій (flex:1 → margin-top:auto) [claude-code]
- **22 сторінки очищено** — видалено дубльовані script/CSS теги після merge conflicts [claude-code]
- **Script order fix** — profile.html, shop.html: page JS тепер завантажується після залежностей [claude-code]
- **showToast()** — додано alias в ui.js для chat-page.js [claude-code]
- **Version sync** — `scripts/version-sync.js` — один скрипт для синхронізації версій скрізь [claude-code]
- **Service Worker** — кеш v12→v24 для інвалідації застарілих версій [claude-code]
- **Afisha cascade** — DELETE тепер зберігає done таски [claude-code]
- **295 тестів pass** (api.test.js), 82 certificates, 51 automation [claude-code]

## v23.4.0 — Lead Capture Integration (2026-03-11)
- **Telegram Lead Capture** — приватні повідомлення в бот автоматично створюють лід в CRM, автовідповідь юзеру [claude-code]
- **Universal Webhook** — `POST /api/leads/webhook/universal?source=tiktok|turbo|bnderoga` з Bearer token auth [claude-code]
- **Facebook Lead Ads** — webhook + Graph API v21.0 для отримання даних лідів [claude-code]
- **Instagram DM** — webhook для нових DM повідомлень → автоматичний лід [claude-code]
- **Viber Business** — webhook з HMAC-SHA256 signature verification [claude-code]
- **Lead Notifier** — `services/leadNotifier.js` — Telegram сповіщення менеджерам при новому ліді [claude-code]
- **UI оновлення** — 12 джерел у sourceFilter (TG, FB, IG, Viber, TikTok, Turbo, BnD, Google, Рек, Повтор, Ручний, Інше) [claude-code]
- **Source badges** — кольорові бейджі для кожного джерела (customers + leads pages) [claude-code]
- **DB Migration 053** — `external_id`, `raw_payload`, `source_channel` + unique index для дедуплікації [claude-code]
- **JWT bypass** — webhook paths відкриті без автентифікації [claude-code]

## v23.3.0 — OmniClaw Security Hardening (2026-03-11)
- **Webhook Signature Verification** — Viber HMAC-SHA256 (X-Viber-Content-Signature), Meta X-Hub-Signature-256 з timingSafeEqual, SMS/Binotel X-Webhook-Secret header [claude-code]
- **API Token Security** — FB/IG access_token перенесено з URL query string в Authorization: Bearer header [claude-code]
- **Graph API Update** — v18.0 → v21.0, конфігурується через FB_API_VERSION / IG_API_VERSION env [claude-code]
- **Pool Safety** — pool.connect() обгорнуто в try-catch у 5 функціях omni-hub.js (запобігає unhandled rejection при вичерпаному пулі) [claude-code]
- **Input Validation** — senderName/phone truncate до DB limits (255/50), getConversations whitelist status/channel, assignedTo type+length check, parseId на всіх route :id params [claude-code]
- **HTTP Status Checks** — перевірка statusCode в fbRequest, igRequest, turboSmsRequest, viberRequest (розрізняє 429/401/500) [claude-code]
- **Normalizer Hardening** — safeCoords() перевіряє Number.isFinite, safeString() з maxLen, isValidUrl() protocol check, JSON.stringify cap для unknown channels [claude-code]
- **Phone Validation** — normalizePhone() E.164 cap (15 digits max), reject < 7 digits [claude-code]
- **getUserProfile Security** — fields array sanitized з regex whitelist /^[a-z_]+$/i + encodeURIComponent [claude-code]
- **Нові env vars** — META_APP_SECRET, SMS_WEBHOOK_SECRET, BINOTEL_WEBHOOK_SECRET (всі опціональні, graceful skip) [claude-code]

## v23.0.0 — Major Release: Full Version Sync (2026-03-11)
- **Version Sync** — повна синхронізація версій по всіх 25+ HTML файлах, package.json, swagger.js, SNAPSHOT, CHANGELOG [claude-code]
- **Landing Carousel** — команда з каруселлю, Anli Lektor, swipe/dots/arrows [kleshnya]
- **Manager Guide** — нова сторінка landing/manager-guide.html для менеджерів з продажу [kleshnya]
- **Cache Busting** — ?v=23.0.0 на всіх CSS/JS ресурсах (25 HTML файлів)
- **Swagger API** — версія OpenAPI spec оновлена з 20.12.0 до 23.0.0
- **Dashboard fix** — версія в login subtitle оновлена (було v22.18.1)
- **game.html fix** — нормалізований ?v= тег (було 22.20.0.1)

## v22.20.0 — Guardian Phase 3: Analytics & Intelligence (2026-03-11)
- **14 Guardian chat commands** — /g help, status, stats, mood, health, top, history, mute, unmute, trust, report, rules, learn, config [claude-code]
- **Channel Health Score** — real-time 0-100, 🟢🟡🔴 indicator, auto-calculation, history [claude-code]
- **Sentiment Tracking** — keyword-based mood analysis per message, per-user summaries [claude-code]
- **Guardian Analytics Panel** — 5 tabs: overview, health, mood, heatmap, trust [claude-code]
- **Activity Heatmap** — 7×24 hourly grid [claude-code]
- **Trust Score System** — 0-100, 4 levels (trusted/normal/watched/restricted) [claude-code]
- **Auto-Escalation** — 5-level: warn → mute 1m → 10m → 30m+TG → ban 1 day [claude-code]
- **Weekly Reports** — Monday digest with trends + Telegram delivery [claude-code]
- **29 API endpoints + 8 DB tables** — migration 051 [claude-code]

## v22.19.0 — Guardian Contour System Phase 2 (2026-03-11)
- **Telegram алерти** — критичні події Guardian → директору в Telegram [claude-code]
- **Inline action buttons** — дії з Guardian DM (мютити обох, попередження, спостерігаю) [claude-code]
- **Security Panel UI** — статистика, активні мути, unmute кнопки [claude-code]
- **Conflict detector** — вікно 15 повідомлень + reply chain awareness [claude-code]
- **Sensitive patterns** — паролі, JWT, API ключі, адреси, дати народження [claude-code]
- **Repeat offender tracking** + **Spam detection** [claude-code]

## v22.18.0 — CRM Tech Debt + Features (2026-03-10)
- Issues #18–#26: технічний борг та нові фічі
- Version bump та синхронізація

## v22.12.0–v22.17.0 — Match-3 Candy Crush Edition (2026-03-09–10)
- **v22.17.0** — UI polish: contrast, style, mystical vibe [kleshnya]
- **v22.16.0** — Candy Crush icons + idle/combo/special animations [kleshnya]
- **v22.15.0** — Icon fix: replace v4 icons with consistent v3/final candy style [kleshnya]
- **v22.12.0** — Match-3 custom art assets [kleshnya]

## v22.10.0–v22.11.0 — Dark Mode Polish + Mystic Edition (2026-03-09)
- **v22.11.0** — Match-3 Mystic Edition: tarot cards, bosses, events, modern UI [claude-code]
- **v22.10.0** — Dark Mode Polish: 92 нових overrides + JS color fixes [claude-code]
- Security Hardening — input validation, race conditions, error disclosure [claude-code]
- Gamification Hardening — DB integrity, bug fixes, tests [claude-code]

## v22.4.0–v22.9.0 — Gamification V2 + Match-3 Epic (2026-03-09)
- **v22.9.0** — Match-3 Epic Edition: 9x9 grid, frozen tiles, cross special, combo system [claude-code]
- **v22.8.0** — Redesigned confirm dialogs, replaced native confirm()/alert() [claude-code]
- **v22.7.0** — Match-3 upgrade: special pieces, scoring fix, dashboard & profile fixes [claude-code]
- **v22.6.0** — Stability audit + version bump [claude-code]
- **v22.5.0** — Custom confirm modals, purchase effects, cooldown reset, chat fix [claude-code]
- **v22.4.0** — Gamification V2: Quiz, Streaks, Room page, Match-3 improvements [claude-code]

---

## v22.0.0–v22.3.0 — Dashboard, Gamification, Game Profile (2026-03-08–09)

### v22.3.0 — Game Profile (09.03.2026)
- Таб "Гра" в профілі (клік на нікнейм) — досягнення, магазин, інвентар, лідерборд
- XP progress bar, рівень, титул, монети в шапці
- Купівля предметів і екіпування з профілю
- Dashboard dark mode fix — картки #2A2A4A з видимими бордерами
- 8 API helper функцій для gamification, 300 рядків CSS

### v22.2.0 — Gamification MVP (09.03.2026)
- Gamification service (727 рядків): XP, рівні, монети, стріки
- Achievement catalog — 20 досягнень з рідкостями та нагородами
- Character items — backgrounds, frames, hats, weapons, shields, outfits, effects, badges
- Shop — магазин предметів за монети з інвентарем
- Leaderboard — таблиця лідерів по XP/монетах/досягненнях
- API: /api/gamification/* (10 ендпоінтів)
- DB: міграція 039_gamification.sql (10 нових таблиць)
- Standalone profile.html + profile-page.js

### v22.1.0 — Messenger UX (09.03.2026)
- Пошук емодзі з фільтрацією по ключових словах
- Lightbox для зображень з галереєю
- Unread separator, scroll badge, reaction popup, drag overlay
- ARIA, keyboard navigation, touch/mobile, safe-area-inset
- Dashboard SQL fix (price, label, staff_schedule)

### v22.0.0 — Dashboard + 25 Roles + Navigation (08.03.2026)
- Персоналізована HOME-сторінка /dashboard з віджетами
- 25 ролей (було 10): бухгалтер, арт-директор, маркетолог, IT, HR, шеф-кухар, кондитер, рецепція та ін.
- Тест-панель creator для переключення ролей
- Onboarding wizard, Widget API з кешем
- role_definitions таблиця з departments та parent_role

---

## v21.12.0–v21.15.0 — Navigation, Polish, Accessibility (2026-03-08)

### v21.15.0 — Unified Navigation
- Sidebar NAV_ITEMS: 9 → 18 пунктів навігації
- Sidebar.init() на всіх 15 standalone-сторінках
- Уніфікована toast система на всіх page-JS файлах

### v21.14.0 — Polish + A11y + Tablet
- Синхронізація ?v= тегів на 13 standalone-сторінках
- iOS zoom prevention (16px на input/select/textarea)
- Touch targets 44px+ (WCAG 2.1)
- Tablet breakpoint 769-1023px
- Dark mode auto-init на всіх standalone-сторінках

### v21.12.0–v21.13.0 — Dark Mode Fix + Role Hierarchy
- Виправлено dark mode toggle + auto night theme
- Configurable night time (start/end)
- Role hierarchy display, dashboard в sidebar

---

## v20.9.12–v20.9.15 — CRM Big Sprint (2026-03-03)

**Supabase міграція, Ліди, Банкети, Staff Extension**

### v20.9.15 — Staff Extension
- `staff.contract_type` VARCHAR(20) — fulltime/parttime/contract
- `staff.skills` TEXT[] — масив навичок
- HR модалка: telegram_username, тип контракту, навички
- Міграція: 026_leads_banquet_staff.sql (частина 26.3)

### v20.9.14 — Banquet Booking
- `bookings.banquet_menu` TEXT, `banquet_guests` INT, `banquet_tables` INT
- Форма бронювання: автоматичне показ/приховання банкетних полів при category=banquet
- Таймлайн: банкетні блоки з amber стилем (border-left #F59E0B, gradient)
- POST/PUT бронювань включають банкетні дані

### v20.9.13 — Leads Page
- Standalone сторінка `/leads` з воронкою, фільтрами, пошуком
- `leads.instagram`, `leads.source`, `leads.lost_reason`, `leads.booking_id` (FK)
- GET `/api/leads/stats` — статистика по статусах
- Кнопка "Конвертувати в бронювання" з pre-fill
- Sidebar: додано навігацію "Ліди"

### v20.9.12 — Supabase Customers
- `db/supabase.js` — Supabase клієнт з lazy init та fallback
- `routes/customers.js` — повний CRUD через Supabase (fallback на Railway DB)
- POST `/api/customers/migrate-to-supabase` — ендпоінт для міграції існуючих клієнтів
- Inline створення клієнтів у бронюваннях — також через Supabase

---

## v20.7.0 — Sales Features (2026-02-26)

**Продажні фічі за Якубою ч.2 — ліди, конверсія, рекомендації, скрипти**

### Hot Leads (Гарячі ліди)
- Таблиця `leads` — трекінг запитів від клієнтів
- API: GET/POST/PATCH/DELETE `/api/leads`, GET `/api/leads/hot`
- Крон 09:00 та 15:00 — автоматичне створення задач для лідів без відповіді 24+ год
- Telegram алерт при наявності гарячих лідів
- UI блок "🔥 Гарячі ліди" в /center Overview

### Manager Conversion (Конверсія менеджерів)
- GET `/api/analytics/conversion` — бронювань/підтверджено/конверсія%/середній чек по менеджерах
- Таблиця з прогрес-барами конверсії в /center Overview

### Age Recommendations (Рекомендації по віку)
- AGE_RECOMMENDATIONS: 3-5 / 6-8 / 9-12 / 12+ → відповідні програми
- Показуються в модалці бронювання після введення дати народження дитини
- Клік на рекомендовану програму → автоматичний вибір

### Sales Scripts (Скрипти продажів)
- Таблиця `sales_scripts` (7 seed фраз: заперечення, закриття, апсейл)
- API: GET/POST/PUT/DELETE `/api/scripts`
- Quick-access в модалці бронювання — вкладки по категоріях + кнопка "Копіювати"

### Auto Follow-up Tasks
- При створенні бронювання автоматично створюється задача
- Дедлайн: за 2 дні до події
- Текст: "Підтвердити свято: [клієнт] [дата]"

### Other
- `bookings.source` — нова колонка для джерела бронювання
- Міграція: 024_page_statuses_leads_scripts.sql

## v20.6.0 — Status Badges + Menu Refactor (2026-02-26)

**Статус-бейджики на sidebar + рефакторинг timeline menu**

### Status Badges
- Таблиця `page_statuses` — 5 статусів: building (🔴), testing (🟠), updated (🟡), in_tests (🔵), ready (🟢)
- API: GET `/api/page-statuses`, PATCH `/api/page-statuses/:path`
- sidebar.js автоматично завантажує статуси і рендерить бейджики
- CSS: крапка (collapsed) або pill з текстом (expanded)

### Menu Refactor
- Видалено дублюючі навігаційні посилання з timeline dropdown (Програми, Задачі — вже є в sidebar)

### Bugfixes
- `/auth/verify` тепер читає роль з БД а не з JWT (фікс для кешованих ролей після міграції)
- `routes/center.js` — замінено hardcoded `role !== 'admin'` на `requireMinRole('senior_manager')`
- Cache-busting: всі HTML `?v=` бампнуті до 20.70

---

## v17.1.0 — AI Team & Contractor Cards (2026-02-22)

**Редизайн AI-команди: акордеон-панелі, журнал, відправка на завдання**

### AI Team картки (HR → AI Команда)
- **Повний редизайн** — замінено зламану grid-сітку на повноширинні картки
- **Акордеон-панелі** — Можливості, Інтеграція, Журнал розкриваються по кліку
- **Відправка на завдання** — ручна форма для відправки AI-працівника
- **Журнал виконання** — in-session трекінг завдань з таймстемпами
- **Dark mode** — повна підтримка темної теми для всіх елементів

### Виправлення
- **Changelog CSS** — змінено `changelog-entry` → `changelog-section` (існуючий клас з CSS)
- **Версійний workflow** — повне оновлення 5 точок (package.json, CSS/JS tags, tagline, button, entry)

---

## v17.0.0 — Export, Budget & Procurement (2026-02-22)

**3 великі фічі: Export Excel/PDF, Бюджетне планування, Система закупок**

### Export Excel/PDF
- **Excel (.xlsx)** — експорт фінансів, клієнтів, закупок через `exceljs`
- **3 ендпоінти** — `/api/finance/export-xlsx`, `/api/customers/export-xlsx`, `/api/procurement/export-xlsx`
- **PDF** — print-friendly CSS на сторінці складу та закупок (Ctrl+P → PDF)
- **Стилізовані файли** — заголовки, формат, автоширина колонок

### Бюджетне планування (план vs факт)
- **Таблиця `budget_plans`** — план по категоріях × місяцях, UNIQUE(year, month, category_id)
- **Upsert API** — `PUT /api/finance/budget` (створення або оновлення)
- **Порівняння** — `GET /api/finance/budget/comparison?year=2026&month=2` з % виконання
- **Фронтенд** — новий таб «Бюджет» в Фінансах з KPI-картками та таблицею план/факт/різниця/%

### Система планування закупок
- **2 таблиці** — `procurement_lists` (списки) + `procurement_items` (позиції)
- **Відділи** — аніматорська, хозка, кафе, техніка, адміністрація
- **Статуси** — чернетка → затверджено → в процесі → закуплено → доставлено
- **Повний CRUD** — 10 API-ендпоінтів для списків та позицій
- **Авто-поповнення** — `GET /api/procurement/suggestions/low-stock` генерує списки з нестач
- **Авто-реstock** — `POST /api/procurement/:id/complete` поповнює склад + записує в історію
- **Фронтенд** — новий таб «Закупки» на сторінці складу з фільтрами, картками, деталями
- **Excel export** — вивантаження списків закупок з фільтрами

### Технічне
- **Міграція 009** — `budget_plans`, `procurement_lists`, `procurement_items` + індекси
- **routes/procurement.js** — новий маршрутний модуль (300+ рядків)
- **exceljs** — нова залежність
- **22 нові тести** — budget CRUD, procurement CRUD, items, suggestions, complete, excel export
- **288 тестів** загалом (287 pass)
- Cache bust: `?v=17.0` all files

---

## v16.2.0 — Swagger API Docs (2026-02-22)

**Інтерактивна документація API — /api-docs**

- **Swagger UI** — інтерактивна документація на `/api-docs` з можливістю тестувати ендпоінти
- **OpenAPI 3.0** — повна специфікація: 136 ендпоінтів, 54 схеми, 25 тегів
- **Нові модулі в spec** — Customers, Finance, Analytics, HR, Designs, Contractors, Warehouse (раніше не задокументовані)
- **JSON spec** — `/api-docs.json` для автогенерації клієнтських бібліотек
- **Публічний доступ** — Swagger UI не потребує авторизації
- **swagger-ui-express** — нова залежність
- Cache bust: `?v=16.2` all files

---

## v16.1.0 — Analytics v2 (2026-02-22)

**Єдиний дашборд — бронювання + фінанси + HR + CRM**

- **Сторінка «Аналітика»** — `/analytics` з KPI-картками, графіками, порівнянням
- **KPI-дашборд** — 6 карток: виручка, бронювання, середній чек, фінанси (дохід/витрати/прибуток), нові клієнти, HR (години/працівники)
- **Порівняння періодів** — автоматичний розрахунок vs попередній період з % зміни (▲/▼)
- **Графіки** — доходи бронювань по днях, фінансові потоки по днях, топ-10 програм, навантаження по днях тижня
- **Фінансові категорії** — горизонтальні бари з кольорами та іконками
- **Сегменти клієнтів** — чемпіони (5+), лояльні (3-4), нові (1-2), неактивні
- **Періоди** — сьогодні, тиждень, місяць, квартал, рік, довільний діапазон
- **API** — 3 ендпоінти: `/api/analytics/overview`, `/charts`, `/comparison` (5-хвилинний кеш)
- **Навігація** — посилання «Аналітика» на всіх 11 сторінках
- **Нові файли:** `analytics.html`, `js/analytics-page.js`, `routes/analytics.js`
- **Тести:** 8 нових тестів (overview, charts, comparison, static page)
- Cache bust: `?v=16.1` all files

---

## v16.0.0 — Finance Module (2026-02-22)

**Фінансовий модуль — каса, P&L, зарплати**

- **Сторінка «Фінанси»** — `/finance` з 4 табами (дашборд, транзакції, місячний звіт, зарплати)
- **Дашборд** — доходи/витрати/прибуток за період, графік по днях, розбивка по категоріях, методи оплати
- **Транзакції CRUD** — створення/редагування/видалення операцій, фільтри по типу/категорії/оплаті/даті
- **P&L звіт** — щомісячна таблиця доходів/витрат/прибутку за рік + графік по місяцях
- **Зарплатний звіт** — розрахунок зарплат з HR (ставка × години), таблиця працівників
- **Категорії фінансів** — 12 початкових (5 доходу + 7 витрат), CRUD для користувацьких категорій
- **Автозапис з бронювань** — підтверджені бронювання автоматично створюють транзакцію доходу
- **Спосіб оплати** — `bookings.payment_method` (готівка/картка/переказ/змішаний)
- **Вартість сертифікатів** — `certificates.value_uah` поле
- **CSV-експорт** — вивантаження фінансових операцій (UTF-8 BOM, `;` separator)
- **Навігація** — посилання «Фінанси» на всіх 10 сторінках
- **Нові файли:** `finance.html`, `js/finance-page.js`, `routes/finance.js`
- **БД:** `finance_categories`, `finance_transactions` + індекси
- **Тести:** 21 новий тест (categories, CRUD, dashboard, monthly, CSV, static page)
- Cache bust: `?v=16.0` all files

---

## v15.1.0 — CRM Phase 2 (2026-02-22)

**Повна клієнтська база з аналітикою**

- **Сторінка CRM** — `/customers` з таблицею клієнтів, пошуком, пагінацією
- **Фільтри клієнтів** — по джерелу (Instagram, Google, рекомендація), візитах, даті, сортування
- **RFM-аналітика** — Recency/Frequency/Monetary з 5 сегментами: чемпіони, лояльні, потенційні, під загрозою, втрачені
- **Автопривітання ДН** — щоденний Telegram о 09:00 з іменинниками та контактами батьків
- **Зв'язок сертифікатів** — `certificates.customer_id` + відображення в картці клієнта
- **CSV-експорт** — вивантаження бази клієнтів з усіма полями (UTF-8 BOM, роздільник `;`)
- **Stats API** — `/api/customers/stats` — огляд бази (кількість, джерела, топ клієнти, середні)
- **Навігація** — посилання «Клієнти» на всіх 9 сторінках
- **Нові файли:** `customers.html`, `js/customers-page.js`
- **Тести:** 11 нових тестів (filters, stats, RFM, CSV, certificates)
- Cache bust: `?v=15.1` all files

---

## v15.0.0 — HR Module (2026-02-22)

**Повноцінний HR-блок**

- **HR-модуль** — нова сторінка `/hr` з 4 табами
- **Хто зараз** — live-табло присутності з кнопками clock-in / clock-out
- **Розклад** — планування змін на тиждень/місяць, шаблони, копіювання тижня, bulk-операції
- **Команда** — картки профілів, контакти, екстрений контакт, ставки, фільтрація за ролями
- **Звіти** — місячна аналітика відвідуваності, підрахунок зарплат, CSV-експорт
- **Cron-jobs** — авто-закриття незакритих змін (23:55 Kyiv), no-show детектор (13:00 Kyiv)
- **Міграція 007** — hr_shifts, hr_time_records, hr_shift_templates, hr_audit_log + розширення staff
- **API** — 20+ ендпоінтів `/api/hr/*` (staff, shifts, clock-in/out, reports, templates)
- **Навігація** — HR-лінк додано у всі сторінки

---

## v14.4.0 — Тест 35 (2026-02-22)

**Тест 35**

---

## v14.3.0 — Тест 34 (2026-02-22)

**Тест 34**

---

## v14.2.0 — Тест 33 (2026-02-21)

**Тест 33**

---

## v13.0.0 — Kleshnya Chat v2 (2026-02-18)

**Kleshnya Chat v2 — ChatGPT-style multi-session redesign:**
- Sidebar сесій (desktop 280px, mobile overlay по свайпу/кнопці)
- Multi-session: створення, перемикання, перейменування, pin, emoji, видалення
- Context menu (right-click / long press): rename, pin, clear, delete
- Media bubbles: image, audio, video з proxy через /api/kleshnya/media/file/:fileId
- Reactions (👍/👎) toggle на assistant повідомленнях
- Generation indicator з animated progress bar (~30 сек)
- WebSocket real-time: kleshnya:thinking, kleshnya:reply, kleshnya:media
- Voice input (Web Speech API)
- FAB на мобільному для "Новий чат"
- Rename modal з emoji picker
- Повна dark mode підтримка для всіх нових компонентів
- JS виділено в окремий файл js/kleshnya-page.js

**Smart Chat engine (12 навичок):**
- 📊 Бронювання — деталі, клієнти, кімнати, ціни по датах/тижням/місяцям
- 📋 Задачі — мої/всі/прострочені з пріоритетами та статусами
- ✏️ Створення задач — "Створи задачу купити серветки" прямо з чату
- 🔥 Стрік і бали — стрік, бали, лідерборд команди
- 👥 Команда — хто на зміні по відділах з часами
- 💰 Фінанси — виручка, середній чек, % росту порівняно з минулим періодом
- 🎪 Афіша — заплановані події по датах
- 🎭 Програми — каталог з категоріями, цінами, деталями
- 🎫 Сертифікати — активні, що скоро спливуть
- 🏠 Кімнати — завантаженість по кімнатах
- 📈 Аналітика — порівняння місяців, топ програм
- ❓ Допомога — повний список навичок з прикладами

**Фільтр по категоріях послуг:**
- "Скільки піньят за тиждень?" → кількість, виручка, список по кожному бронюванню
- Підтримує: піньяти, квести, шоу, анімації, майстер-класи, фото
- Розуміє періоди: сьогодні/завтра/тиждень/місяць/вихідні

**Suggestion chips:**
- Після кожної відповіді 2-4 кнопки follow-up запитів
- Контекстні — залежать від теми відповіді
- Анімоване з'явлення, dark mode підтримка

**Backend:**
- `services/kleshnya-chat.js` — новий skill engine з реальними DB запитами
- `services/kleshnya-bridge.js` — Telegram Bridge для OpenClaw (227 рядків)
- `routes/kleshnya.js` — повний CRUD sessions, paginated messages, reactions, media proxy
- `services/websocket.js` — kleshnya:thinking, kleshnya:reply, kleshnya:media events
- `db/migrations/005_kleshnya_chat_v2.sql` — chat_sessions, kleshnya_media

**Cache bust:** `?v=13.0` на всіх CSS/JS всіх 7 сторінок

---

## v12.1.0 — Розумна тема + UX (2026-02-17)

**Авто Dark Mode:**
- Темна тема автоматично з 20:00 до 07:00, світла вдень
- Спільна функція `initDarkMode()` в config.js — єдине джерело правди
- Працює на всіх 6 сторінках (таймлайн, задачі, програми, графік, дизайни, клешня)
- Ручний вибір через toggle зберігається в localStorage і перезаписує авто

**Dark mode на /designs:**
- Повне покриття: картки, фільтри, drop zone, таби, прайс-лист, календар, модалки
- Інтегровано і `body.dark-mode` і `[data-theme]` для повної сумісності

**Мобільний UX /designs:**
- Картинки: `object-fit: contain` — повний дизайн без обрізання
- Таби: горизонтальний скрол (нічого не обрізається)
- Фільтри: один компактний рядок замість 3
- Drop zone: тонкий бар замість великого блоку
- Кнопки: `min-height: 36px` для зручного натискання

**Фікс авторизації /designs:**
- Прибрана залежність від `pzp_session` (ніколи не записувався)
- Тепер використовує `/api/auth/verify` як tasks/programs/staff

**Фікс горизонтального скролу:**
- `overscroll-behavior-x: contain` на всіх scroll-контейнерах
- Жест на мобільному більше не зсуває всю сторінку

**Cache bust:** всі HTML файли оновлені до `?v=12.1`

---

## v11.0.6 — Клешня знає твоє ім'я (2026-02-15)

- **Персоналізація:** привітання тепер звертаються по імені з акаунту користувача
- **Фікс:** "Денний" більше не з'являється — displayName передається з JWT токена
- **Шаблони:** GREETINGS тепер функції з параметром імені
- **Кеш:** очистка кешу привітань при кожному старті сервера

---

## v11.0.4 — Клешня без пафосу (2026-02-15)

- **Привітання:** жива українська замість "сканування завершено" / "системи активовано"
- **Відповіді:** просто та корисно без "місій", "оперативників", "сенсорів"
- **Кнопки:** Задачі (замість Місії), Аніматори (замість Оперативники)
- **Divider:** "ШВИДКІ ЗАПИТИ" замість "МОДУЛІ ЗАПИТІВ"
- **Footer:** "Відкрити чат" замість "Повний термінал"

---

## v11.0.3 — Голографічний Термінал (2026-02-15)

- **FAB:** radial gradient + обертове dashed-кільце + sonar pulse з neon glow
- **Popup:** темний термінал (#1a1520), scan line overlay, monospace шрифт (Courier New)
- **Header:** блимаючий зелений status dot, "KLESHNYA v3.0 / ONLINE" в стилі командного центру
- **Greeting:** typing-анімація (символ за символом) з блимаючим курсором █
- **Answer:** термінальний блок з `>>` prompt, зеленим акцентом, typing ефект
- **Buttons:** sweep-ефект (gradient пролітає по кнопці), ◈ іконки з обертанням на hover
- **Divider:** "МОДУЛІ ЗАПИТІВ" з gradient-лініями
- **Footer:** "Повний термінал →" з ⬡ іконкою
- **Dark mode:** посилений glow на FAB/popup/buttons
- **Responsive:** адаптовано для 480px

---

## v11.0.2 — Футуристична Клешня (2026-02-15)

- **Floating widget:** інтерактивна кнопка 🦀 (FAB) замість статичного банера в stats bar
- **Popup:** привітання + 4 кнопки швидких питань (бронювання, задачі, стрік, аніматори) + посилання на повний чат
- **Футуристичний стиль:** всі привітання та відповіді переписані в стилі командного центру (скан, місії, оперативники, модулі аналізу)
- **Dark mode + responsive:** повна підтримка для нового віджету
- CSS: layout.css, dark-mode.css, responsive.css — нові стилі для FAB + popup
- JS: timeline.js — initKleshnyaWidget(), handleKleshnyaQuestion()

---

## v11.0.1 — Документація та Swagger (2026-02-15)

- **PROJECT_PASSPORT.md:** повна актуалізація до v11.0 (30 таблиць, 17 routes, 13 services, Kleshnya greeting/chat, особистий кабінет, schedulers)
- **CLAUDE.md:** виправлені невідповідності (19 JS, 11 CSS, 364 тести, повна файлова структура)
- **swagger.js:** v8.6.1 → v11.0.0 (+25 endpoints, +10 schemas: points, kleshnya, recurring, stats, auth profile/achievements/password, task logs)
- **SNAPSHOT.md:** коректна кількість тестів (364)

---

## v11.0.0 — Дофамінові покращення (2026-02-15)

**Kleshnya Greeting & Chat:**
- Quick stats bar → two-column layout: статистика ліворуч, Kleshnya banner праворуч
- Персоналізовані привітання на основі бронювань, задач, стріків, часу доби
- Greeting cache в БД (4h TTL) для rate-limit майбутніх AI agent викликів
- Повна чат-сторінка `/kleshnya` з історією повідомлень
- Template-based responses (agent-ready hook для майбутньої AI інтеграції)
- API: GET/POST `/api/kleshnya/greeting`, GET/POST `/api/kleshnya/chat`
- Dark mode + responsive support

**Особистий кабінет — повна перебудова:**
- 4 таби: Сьогодні / Задачі / Стати / Налашт.
- **Сьогодні:** shift block, SVG progress ring, actionable inbox (прострочені + майбутні задачі з done/start), admin team overview grid
- **Задачі:** inline status actions (start/done), blocked task indicators, dependency awareness, priority highlighting, animated task completion
- **Стати:** stat cards з week-over-week deltas, бали з task links, escalation history, certificate details, 12 achievements grid
- **Налашт.:** зміна пароля, user details, logout
- 12 досягнень (first_task, streak_3/7/30, booking_pro тощо) з auto-grant логікою
- `user_action_log` таблиця + POST/GET endpoints для UI click tracking
- `user_achievements` + `user_streaks` таблиці
- PATCH `/tasks/:id/quick-status` для inline task actions з профілю
- 23 паралельні SQL запити у `/profile` endpoint (Promise.allSettled)
- ~500 рядків нових CSS стилів (tabs, progress ring, shift block, inbox, team grid, achievements)

**БД (+3 таблиці):**
- `kleshnya_messages` (greeting cache), `kleshnya_chat` (chat history)
- `user_action_log`, `user_achievements`, `user_streaks`

**Файли:**
- `kleshnya.html` — нова сторінка чату
- `services/kleshnya-greeting.js` — новий (greeting engine)
- `routes/kleshnya.js` — новий (API greeting + chat)
- `routes/auth.js` — розширений `/profile` з 23 queries
- `js/auth.js` — перебудований profile modal з 4 табами
- `js/api.js` — +kleshnya API methods
- `js/timeline.js` — kleshnya banner на головній
- `css/modals.css` — +500 рядків profile styles
- `css/layout.css`, `css/dark-mode.css`, `css/responsive.css` — kleshnya layout

---

## v10.5.0 — Verification Bump (2026-02-15)

- **Profile modal на суб-сторінках:** tasks.html, programs.html, staff.html — додані modals.css та profile modal HTML
- **Modal UX:** close (×), backdrop click, Escape key в initProfileHandler
- **Auto-init:** profile click handler через DOMContentLoaded на всіх сторінках
- Всі 221 тестів пройдено

---

## v10.4.0 — Особистий кабінет PRO (2026-02-15)

- **Кабінет PRO:** повна переробка з 15+ SQL запитами через Promise.allSettled (паралельні)
- **Увага:** блок "Потребують уваги" — прострочені задачі, дедлайни < 24 год
- **Мої задачі:** inline-список з пріоритетами, дедлайнами, статусами (overdue виділені)
- **Бали:** транзакції останніх нарахувань з причинами (ON_TIME, EARLY, LATE тощо)
- **Лідерборд:** ранг #N серед усіх користувачів
- **Бронювання:** розбивка по статусах (підтверджені/попередні/скасовані), виручка (admin only), топ-3 програми
- **Сертифікати:** видані по статусах (активні/використані)
- **Задачі:** середній час виконання, кількість ескалацій, розбивка по категоріях
- **Зміна пароля:** PUT /api/auth/password з валідацією та bcrypt
- **Активність:** збільшено до 20 записів + пагінація "Показати ще"
- **Telegram:** статус підключення у профілі (badge)
- **UX:** мобільний responsive (3+2 grid на малих екранах), 5 stat cards замість 4

---

## v10.3.0 — Особистий кабінет (2026-02-15)

- **Особистий кабінет:** клік по імені користувача відкриває модальне вікно з персональною інформацією
- **API:** GET /api/auth/profile — консолідований профіль (user info + points + tasks + bookings + activity)
- **Профіль:** аватар, роль, дата реєстрації, статистика (бронювання, задачі, бали), остання активність
- **UX:** username кликабельний з underline hint, повна keyboard accessibility

---

## v10.2.0 — Reliability (2026-02-15)

- **Logging:** замінені всі `/* non-blocking */` catch блоки на log.warn з context (scheduler, afisha)
- **ROLLBACK safety:** distributeAfishaForDate — ROLLBACK з .catch() і логуванням помилки
- **Graceful shutdown:** drain in-flight Telegram запитів перед закриттям DB pool (drainTelegramRequests)
- **Body limit:** /api/backup/restore збільшений до 50mb (великі SQL дампи)

---

## v10.1.0 — Data Integrity (2026-02-15)

- **Migration 004:** unique partial indexes для дедуплікації recurring bookings, tasks, afisha (template_id + date)
- **Migration 004:** додані відсутні індекси: bookings(status), tasks(assigned_to), tasks(assigned_to, date)
- **Atomic dedup:** scheduler recurring tasks і afisha використовують INSERT ON CONFLICT замість SELECT → INSERT (race condition fix)
- **Optimistic locking:** updateTaskStatus перевіряє version column перед UPDATE (захист від конкурентних змін)
- **DB:** додана колонка `tasks.version` (INTEGER DEFAULT 1) для optimistic locking

---

## v10.0.1 — Security Hotfix (2026-02-15)

- **RBAC:** tasks write-операції (POST/PUT/PATCH/DELETE) обмежені ролями admin/user, viewer = read-only
- **RBAC:** points leaderboard = admin/user, individual points = own + admin, history = own + admin
- **Security:** parseInt валідація в Telegram callback handlers (NaN guard з early return)
- **Security:** приховані DB error messages у backup endpoints (no schema leakage)
- **Security:** валідація `type` параметра в tasks GET query filter
- **Security:** обмежений offset в points history (max 10000, DoS prevention)

---

## v10.0.0 — Tasker & Kleshnya (2026-02-15)

**Tasker — операційний центр:**
- Централізований задачник з двома типами: `human` (людина) / `bot` (система)
- Дві ролі: `owner` (менеджер, ескалація) + `assigned_to` (виконавець)
- Дедлайни, вікна виконання, залежності між задачами
- `control_policy` (JSONB) — правила нагадувань та ескалації на рівні задачі
- `source_type` — відстеження джерела задачі (booking, trigger, recurring, kleshnya)

**Клешня (services/kleshnya.js) — центральний інтелект:**
- Створення задач з логуванням + нотифікацією
- 4-рівнева ескалація: м'яке → жорсткіше → увага → директор
- Автоматичне нарахування балів при завершенні задач
- Персональні Telegram-повідомлення (chat_id) + групові (@mention)
- Журнал змін (task_logs) з повною історією

**Система балів:**
- `user_points` — постійні (накопичувальні) + місячні (обнуляються 1-го)
- `point_transactions` — повна історія нарахувань
- Правила: вчасно +5/+2, з запасом +7/+3, high priority +10/+5, прострочено -2..-5
- API: GET /api/points (leaderboard), GET /api/points/:username/history

**Scheduler (3 нові, всього 11):**
- `checkTaskReminders` — щохвилинна перевірка дедлайнів + ескалація
- `checkWorkDayTriggers` — тригери початку дня (10:00/12:00), автозадачі піньят/футболок
- `checkMonthlyPointsReset` — обнулення місячних балів 1-го числа

**Telegram бот (+3 команди, всього 10):**
- `/tasks` — мої задачі на сьогодні (з визначенням юзера через telegram_username)
- `/done <id>` — завершити задачу з нарахуванням балів
- `/alltasks` — всі задачі команди, згруповані по виконавцях
- Inline-кнопки: `task_confirm`/`task_reject` для підтвердження

**БД (+4 таблиці, +15 колонок):**
- tasks: +task_type, +owner, +deadline, +time_window_start/end, +dependency_ids, +control_policy, +escalation_level, +source_type, +source_id, +last_reminded_at
- users: +telegram_chat_id, +telegram_username
- Нові: task_logs, user_points, point_transactions

**Файли:**
- `services/kleshnya.js` — новий (центральний процесор)
- `routes/points.js` — новий (API балів)
- `services/bot.js` — +3 команди (/tasks, /done, /alltasks)
- `services/scheduler.js` — +3 scheduler функції
- `routes/tasks.js` — інтеграція з Клешнею (logs, owner, task_type)
- `routes/telegram.js` — +task_confirm/reject callbacks, auto-register chat_id
- `server.js` — +points route, +3 schedulers
- `db/index.js` — +4 таблиці, +15 колонок, +12 індексів

---

## v9.1.0 — Live-Sync (2026-02-15)

**WebSocket підключено:**
- `services/websocket.js` підключено до `server.js` через `initWebSocket(server)`
- Graceful shutdown: WSS закривається перед DB pool
- `routes/bookings.js`: broadcast після create/create-full/update/delete
- `routes/lines.js`: broadcast після зміни ліній
- `js/auth.js`: ParkWS.connect() при логіні, disconnect() при logout
- userId coerced to String для коректного excludeUser

**SessionStart hook:**
- `.claude/hooks/session-start.sh`: старт PostgreSQL + npm install + env vars
- Працює тільки в remote (Claude Code на вебі)

---

## v9.0.2 — Доступність (2026-02-15)

- Skip-links на всіх 5 сторінках
- `@media (prefers-reduced-motion: reduce)` — вимкнення анімацій
- programs.html: cache bust v7.9.2 → v9.0.2

---

## v9.0.1 — Стабілізація (2026-02-15)

- Staff toolbar: кнопки винесені в окремий `.schedule-toolbar`
- Cache bust staff.html і tasks.html

---

## v9.0.0 — Розумна платформа (2026-02-15)

- **Drag-and-drop** на таймлайні (мишка/палець + resize + undo)
- **Повторювані бронювання** (шаблони щотижня/через тиждень/щомісяця, авто-генерація 14 днів)
- **Аналітика** (дашборд виручки, топ програм, завантаженість)
- **Оптимістичне блокування** (updated_at + PL/pgSQL тригер + HTTP 409)
- **Offline режим** (Service Worker + IndexedDB mutation queue)
- **Міграції БД** (db/migrate.js + 3 міграції)
- **Тести:** certificates.test.js (82) + automation.test.js (51)

---

## v8.6.1 — Оновлений дизайн сертифікатів (2026-02-14)

- Новий фон + QR у лівий нижній кут (150px замість 216px)

---

## v8.6.0 — Розумний розподіл (2026-02-14)

- Birthday blocks: pill-форма з градієнтом + 🎂 + пульсуюча анімація
- Авто-розподіл афіші перед дайджестами та нагадуваннями

---

## v8.5.0–v8.5.2 — Сертифікати (2026-02-13)

- v8.5.0: Панель сертифікатів (slide-in, статистика, градієнтні картки)
- v8.5.1: Графічні сертифікати (Canvas PNG, Містер Зак)
- v8.5.2: Сезонний маскот (4 seasonal ілюстрації)

---

## v8.4.0 — Сертифікати MVP (2026-02-13)

- Реєстр CERT-YYYY-NNNNN, Telegram-сповіщення, scheduler expiry

---

## v8.3.0–v8.3.3 — Автоматизація + Bugfixes (2026-02-12)

- v8.3.0: Automation rules engine + Drag-to-Move афіша
- v8.3.1: МК Футболки (розміри XS-XL в extra_data, 2 автоматизації)
- v8.3.2: Фікс історії (афіша/автоматизація рендеринг) + extra_data в linked bookings
- v8.3.3: Bugfixes (undo в історії, share/copy invite crash fix)

---

## v7.8–v7.9.2 — Задачі & Програми & Мобільна адаптація (2026-02-11–12)

- v7.8: Standalone Tasks & Programs pages + recurring task templates
- v7.8.1–v7.8.9: Мобільна адаптація (свайп, CSS Grid toolbar, glassmorphism, WCAG 44px touch targets)
- v7.8.10: Дайджест для 2го ведучого + афіша ±1год
- v7.9.0: Дошка задач (5 вкладок, канбан, авто-задачі з афіші, категорії)
- v7.9.2: Стилізовані емодзі іконки з градієнтними колами

---

## v7.0–v7.6.1 — Каталог, Бот, Афіша, Задачник (2026-02-11)

- v7.0: Product Catalog MVP (products таблиця, API, кеш 5хв, seed 40 програм)
- v7.1: Admin CRUD каталогу (create/edit/deactivate, requireRole middleware)
- v7.2: Clawd Bot (7 команд: today/tomorrow/programs/find/price/stats/menu)
- v7.3: Афіша в Telegram (дайджест + нагадування з подіями)
- v7.4: Типи подій (event/birthday/regular), іменинники в Telegram
- v7.5: Задачник MVP (tasks CRUD, статуси todo/in_progress/done, пріоритети)
- v7.6: Афіша → Задачі (генерація, шаблони, каскадне видалення)
- v7.6.1: Переключення ліній аніматорів + z-index bugfix

---

## v6.0 — Test Mode (2026-02-08)

- Безпарольний login: будь-який username → admin role, token 24h
- **УВАГА:** тимчасова версія для тестування

---

## v5.30–v5.51 — UI/UX Overhaul & Design System (2026-02-07–08)

| Версія | Що |
|---|---|
| v5.30 | Design System v4.0 (emerald, CSS tokens, 10-file architecture) |
| v5.31–v5.33 | Segmented controls, program cards, booking panel mobile |
| v5.34–v5.35 | Responsive (4 breakpoints, tablet overlay, desktop grid) |
| v5.36–v5.38 | Афіша/Історія UI, dark mode coverage, favicon/PWA |
| v5.39–v5.41 | Bugfixes, security headers, rate limiting, performance (indexes) |
| v5.42–v5.48 | Design tokens, modals polish, dashboard, invite overhaul, inline cleanup |
| v5.49 | Program search |
| v5.50 | Duplicate booking |
| v5.51 | Undo for edit & shift |

---

## До v5.30

- v5.29: Modular backend (routes/, services/, middleware/)
- v5.28: Structured logging, request IDs
- v5.19: Free rooms, booking linking
- v5.18: Room selection

---

*Формат: останні версії детально, старі — коротко.*
