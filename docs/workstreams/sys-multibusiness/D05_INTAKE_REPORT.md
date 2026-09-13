# D05 — Warehouse photo intake

Date: 2026-09-12. Base/HEAD: `a5180def01a1e47f8f4fc75e2f7a43092f205828`.
Branch: `codex/sys-mb-auth-p0-20260912`. This is an incremental local report over the cumulative uncommitted SYS-MB worktree; it is not deployment or live QA evidence.

**Domain status: NOT_MIGRATED / SERVICE_CONTAINED / GLOBAL_CUTOVER_HOLD.** Membership and non-Park CRM intake remain blocked. Every effectful intake service entrypoint now requires an explicit server-authorized legacy context and rechecks registry compatibility before operational data/provider work. Existing Telegram callers supply no business context and are denied; they can no longer create/read/confirm/cancel intake data through these services. The protected webhook still performs its own registration/receipt/reply work described below. No historical owner was assigned and membership intake was not re-enabled.

## Source of truth and actual entrypoints

| Surface | Actual source / behavior | Ownership and status |
|---|---|---|
| Incoming photo/image document | `routes/telegram.js`, `POST /api/telegram/webhook`, `hasWarehousePhotoInput` → `createTelegramPhotoIntake` | No business/chat/actor mapping reaches this service. Missing context now returns unavailable before intake SQL/download/vision. Webhook receipt/registration/generic reply can still execute outside this service. **SERVICE_BLOCKED / protected ingress NOT_MIGRATED**. |
| Draft and photos | `db/migrations/221_warehouse_photo_intake.sql`: `warehouse_photo_intakes`; `warehouse_photo_intake_photos` has an intake FK with cascade deletion | Neither table has an organization/business field. Telegram chat/user/thread IDs, source and raw payload are observations, not owner authority. Historical assignment **BLOCKED**, no mapping approved. |
| Vision and matching | `services/warehousePhotoIntake.js`: download → OpenAI vision → `findMatchCandidates` → persisted JSON draft/candidates | Guards precede provider/data work. An explicitly admitted pre-cutover Park matcher uses exact stored `warehouse_stock.business_context`; foreign and NULL owner candidates are excluded. Name/category/ranking behavior is preserved. **LEGACY_ONLY / membership BLOCKED**. |
| CRM status/list/detail | `routes/warehouse.js`: `GET /photo-intake/status`, `/photo-intake`, `/photo-intake/:id` → service status/list/detail | Existing route gate plus service registry guard. All CRM methods pass their server-resolved context. Reads still use the unowned legacy namespace only after admission; status checks authority before loading bot configuration. **BLOCKED for membership; legacy compatibility is not tenant certification**. |
| CRM confirm | `POST /photo-intake/:id/confirm` → `confirmIntake` | Existing role/revenue checks and explicit legacy Park context retained. Stock/location reads and stock/history/movement writes are scoped to Park. Intake itself is unowned. **BLOCKED for membership**. |
| Telegram confirm | `wh_intake_confirm:<id>` → actor-name resolver → `confirmIntake(id,{actor})` | Missing business context now denies before connection/intake/stock work. Actor lookup and generic callback answer outside the service remain protected follow-up work. **SERVICE_BLOCKED / ingress NOT_MIGRATED**. |
| CRM/Telegram cancel | `/photo-intake/:id/cancel`; `wh_intake_cancel:<id>` → `cancelIntake` | Service admission precedes conditional status update. CRM passes its explicit context; Telegram lacks one and receives unavailable before the update. **BLOCKED for membership and missing context**. |
| Summary/UI | `buildTelegramSummary`; `js/warehouse-page.js` intake cards/status; two `js/api.js` intake read wrappers | Telegram summary still uses the first cached match. CRM now preserves the server denial code and explains unavailable intake instead of showing missing bot configuration or inviting another upload. This UI state does not change server access. |

The durable operational ownership fields already exist on stock/location/history/movements in migration `227_business_context_operational_scopes.sql`; migration `112_warehouse_owner.sql`'s `park|dar|shared` label is not an organization/business identity. The new fixes preserve the prior D01 explicit stock/history/movement context writes. Confirmed stock/history/movement FKs do not prove ownership of an older draft and must not become an automatic backfill rule.

## Independent service containment

Historical mapping blocks re-enablement, not denial. D05 therefore closes the independent service bypass while leaving the ownership migration pending. The effectful exports are `createTelegramPhotoIntake`, `findMatchCandidates`, `getIntake`, `listIntakes`, `getIntakeStatus`, `confirmIntake`, and `cancelIntake`. Pure formatting/normalization helpers do not load operational data or call providers.

The guard reuses `loadLegacyBusinessSurfaceAccess` with the `warehouse_photo_intake` descriptor. Missing/invalid/non-Park context is rejected without SQL or a connection. An explicit exact `event_genix` context checks the current business/organization registry: membership mode, inactive business or inactive/missing organization deny. Dependency read failure produces sanitized `503 warehouse_photo_intake_scope_unavailable`; ordinary unavailability is `403 warehouse_photo_intake_not_migrated`. An absent Park registry record preserves the existing helper's explicit pre-registry compatibility policy; it does not manufacture a context or historical owner. All internal nested intake calls propagate the admitted context instead of silently defaulting to Park.

Read services throw typed unavailable errors; create preserves its `{ok:false, reason, status}` result shape, and confirm/cancel preserve `{success:false, error, status}`. CRM translates these expected errors to their actual403/503 and a stable `code`, rather than a generic500. Existing CRM roles/revenue checks are unchanged.

Every retry checks authority again, including an already-persisted dedupe hit. This is an admission check, **not an atomic namespace cutover**: a registry SELECT does not serialize a previously admitted in-flight provider/read/write operation against a concurrent cutover. Future rollout must quiesce these operations or introduce a reviewed serialization/job policy. No such atomic-cutover guarantee is claimed by these tests.

## Bugs reproduced and fixed locally

### INTAKE-ATOMIC-01 — Missing final intake receipt could still commit stock

Expected: stock/history/movement and the confirmed intake receipt succeed together or all roll back.

Actual before fix: a PostgreSQL `BEFORE UPDATE` trigger returning `NULL` for the intake's confirmed update produces zero updated rows. `confirmIntake` committed the preceding stock/history/movement writes and returned `success:true` with an intake object missing its ID/status. A trigger is a controlled fixture reproducer; this report does not claim such a trigger exists in production.

Reproducer: `tests/integration/d05-warehouse-intake-atomicity-postgres.test.js`, scenario `suppressed final receipt rolls back new stock and existing stock changes`. Real migration 221 is applied in an owned disposable PostgreSQL database; relevant operational tables retain their FK behavior. The trigger suppresses only final receipt updates. Test both new stock and restocking, comparing complete rows before/after.

Fix: after final `UPDATE ... RETURNING`, require exactly one returned intake row before `COMMIT`. Otherwise roll back and return `409 intake_parent_update_failed`. Normal response fields and quantity/price handling are unchanged.

### INTAKE-ATOMIC-02 — Location ownership check did not hold a transaction lock

Expected: a location's checked business and active state remain stable until confirmation commits.

Actual before fix: the SELECT used to validate a location had no row lock. A second PostgreSQL connection could update `business_context` between validation and the stock write. Existing-stock row locking does not lock the referenced location's non-key fields.

Reproducer: the same PG file pauses the real confirmation connection immediately after its location SELECT. A second connection attempts a real location UPDATE, separately for business ownership and active status. Before the fix the UPDATE succeeds during this gap. After the fix it waits on the first transaction and receives `55P03` under the fixture's explicit 500 ms lock timeout; the competitor is rolled back before the confirmation resumes. The barrier is application-controlled, not a timing guess. The fixture allows 15 seconds for ordinary statements.

Fix: add `FOR SHARE` to the existing scoped location SELECT. This blocks concurrent ownership/activation updates within this transaction. It does not prevent an independently authorized writer from changing ownership after confirmation commits; future ownership reassignment requires a separate integrity policy. Existing intake→location→stock lock order is retained. A conflicting transaction may abort normally; no retry or success-swallowing behavior was added.

### INTAKE-UI-01 — A denied queue looked empty and asked users to upload again

The two existing status/list API wrappers discarded non-OK response bodies. The page then treated their generic failure objects as missing bot credentials and an ordinary empty queue. A membership403 therefore looked like a configuration or missing-data problem.

The wrappers now preserve the error code in non-OK JSON responses. The page distinguishes the exact `warehouse_photo_intake_not_migrated` code from a generic loading failure and a successful empty queue. Failure clears both old status data and editable intake cards; the existing refresh button retries normally. A request sequence guard prevents older success/denial responses from overriding the most recent refresh. No shared auth behavior, menu, router, theme, or mutation wrapper changed.

Functional evidence runs the actual two wrappers, actual403 auth-handler branch and the full warehouse page script in JSDOM with synthetic response transport. It covers either endpoint denying, both denying, stale cards, retained login, successful empty compatibility queue, network/HTTP/shape errors, actual refresh-button recovery and both late-response orders. This is not a full browser or live-site assessment.

## Retry and idempotency inventory

| Operation | Existing behavior | Remaining requirement |
|---|---|---|
| Repeated Telegram delivery | Missing context now denies before the dedupe SELECT. Explicit compatible service callers can still return an existing draft | Key has no organization/business/provider binding. Legacy construction still has `unknown`/time fallback; these branches cannot be used by current unowned Telegram callers. Future owned ingress must define stable identity. |
| Concurrent admitted create | After explicit legacy admission, SELECT precedes download/vision and INSERT | An independently authorized legacy internal caller could still issue duplicate provider attempts before one INSERT loses the unique-key race. Current context-free Telegram delivery is blocked. No persisted provider attempt/lease exists; do not test by making real requests. |
| Photo persistence failure | Draft insert and photo inserts run separately through the pool | Partial photo failure can leave a draft. Redelivery returns the draft at the first dedupe SELECT and does not repair missing photo rows. Future durable intake/job design must address atomic persistence and repair. |
| Confirm/replay | Intake row `FOR UPDATE`; closed states reject; stock/history/movement and receipt share one transaction | Verified: one concurrent confirmation succeeds, the other returns `intake_already_closed`; replay produces no extra writes. This is local atomicity, not a tenant guarantee. |
| Cancel/replay | Service admission precedes one conditional UPDATE excluding confirmed/cancelled states | Missing context/registry cutover denies before data access; historical per-row ownership and Telegram actor binding remain pending. |
| Explicit reprocess/retry endpoint | None found in the route/service callers | Do not invent a supported retry API. Provider retry ownership and old-draft recovery need a reviewed contract. |

## Verification

| Check | Result / evidence |
|---|---|
| Canonical runtime | `npm run check:runtime`: Node 22.23.1 / npm 10.9.8, PASS |
| Red PostgreSQL reproduction | `.codex-temp/sys-mb-d05/intake-red.log`: both targeted bugs fail before the fix; success/replay scenarios pass |
| Initial atomicity PostgreSQL evidence | `.codex-temp/sys-mb-d05/intake-postgres.log`: **13 PASS** before service containment; retained as historical incremental evidence |
| Red service containment | `.codex-temp/sys-mb-d05/intake-containment-red.log`: **3 expected failures**, old code reached operational SQL instead of denial |
| Final service/CRM/UI checks | `.codex-temp/sys-mb-d05/intake-containment-final-unit.log`: **24 PASS**, 0 failures/skips; two existing files plus `tests/d05-intake-service-containment.test.js` and the UI file |
| Final intake PostgreSQL | `.codex-temp/sys-mb-d05/intake-containment-postgres.log`: **15 PASS**, 0 failures/skips; includes actual registry cutover/dedupe replay and exact stock owner matching as well as prior atomicity/foreign-reference cases |
| Actual wrappers + page DOM/VM | `.codex-temp/sys-mb-d05/intake-ui.log`: **7 PASS**, 0 failures/skips, `tests/d05-intake-unavailable-ui.test.js` |
| Provider/production activity | No external requests, secrets or production data used; provider calls are trapped in the new PG fixture |

PG command: `wsl -d Ubuntu -u postgres -- env BUSINESS_MEMBERSHIP_LOCAL_POSTGRES_TEST=1 node --test '<worktree-in-WSL>/tests/integration/d05-warehouse-intake-atomicity-postgres.test.js' '<worktree-in-WSL>/tests/integration/warehouse-product-isolation-postgres.test.js'`.
`<worktree-in-WSL>` is `/mnt/c/Users/Plotva/OneDrive/Документи/EventGenix/.worktrees/sys-mb-auth-p0-20260912`.
Both fixtures enforce local-only database configuration, create a randomly named owned test database, close connections and assert its removal. No migration was run on an existing business database. Windows sandbox initially rejected WSL access; the same bounded fixture command succeeded with tool-level approval. That environment error was not a failing product test.

The final PG fixtures explicitly model an active organization and a pre-cutover compatibility Park registry, and pass the trusted service context. They do not reopen membership by inventing draft owners. The NULL matcher test temporarily relaxes migration227's normal NOT NULL constraint only in its owned fixture to model corrupt/older imported data, then removes that exact fixture row and restores the constraint.

## Protected webhook quarantine contract — not implemented

`routes/telegram.js` remains unchanged. It records known chats/threads before intake dispatch, may resolve a callback actor, and sends generic failure replies/answers after service denial. Therefore the claim is **no denied intake SQL, download/vision, draft, stock or cancellation work**, not zero effects in the whole Telegram webhook.

A separately authorized intake-only patch would add an early unavailable guard immediately after existing webhook-secret validation and update parsing, before chat/thread registration. Recognize only photo/image-document intake and `wh_intake_confirm:`/`wh_intake_cancel:` callbacks; retain the webhook's HTTP200 receipt on unavailable intake without actor lookup, data/provider action or outbound reply. Do not change other commands/callbacks, bot credentials, settings, external payload contracts, or guess a chat→business assignment. A future trusted channel binding may replace quarantine only after its reviewed ownership model exists.

Required executable tests for that protected patch: actual local webhook requests for each recognized intake shape and duplicate retry assert zero registration/actor/download/vision/intake/Telegram-send calls; invalid webhook secret remains403; unrelated text, command and callback behavior remains unchanged; forged business fields in the external payload cannot supply authority. Use synthetic transports only. No such whole-webhook PASS is claimed here.

## Next ownership package and exact boundary

Implementation owner: warehouse/Telegram integration maintainer. Business decisions: organization owner, with access/security review. Parent SYS-MB acceptance retains **HOLD** for durable intake ownership, protected webhook effects and the wider unmigrated integration surfaces; implemented service containment is an independent local result.

1. Define an authenticated server-owned organization/business/channel/thread registration and actor capability contract; a bot token or Telegram username alone is insufficient. Specify how ambiguous destinations and callbacks are denied before draft/provider work.
2. Collect a dedicated restricted inventory of actual draft/photo/provider/destination relationships. Task 3's catalog/template mapping schema does not include intake tables and must not be stretched silently. Approve historical owners explicitly; unknown/mixed drafts remain unavailable.
3. Prepare a separately approved additive migration for durable intake ownership and an owned idempotency/provider-attempt boundary. Bind callback, draft, photo, attempt and warehouse destination to the same business; define replay, partial persistence recovery and revoke behavior.
4. Replace legacy-only service admission with durable per-row owned reads/matching/status/confirm/cancel and owned webhook/provider entrypoints after the migration. Preserve quantity/price formulas and existing financial permissions. Keep the implemented unavailable UI until that workflow is actually migrated.
5. Reopen membership intake only after real-source mapping/authorization, actual HTTP/PG denial/retry/rollback tests and separately authorized synthetic live QA. Global cutover cannot use the narrow receipt PASS as evidence that intake is supported.

Intake-owned changes: `services/warehousePhotoIntake.js`; intake-only wiring in `routes/warehouse.js`; `js/warehouse-page.js`; only `apiGetWarehousePhotoIntakeStatus`/`apiGetWarehousePhotoIntakes` in `js/api.js`; new `tests/d05-intake-service-containment.test.js`, `tests/d05-intake-unavailable-ui.test.js`, `tests/integration/d05-warehouse-intake-atomicity-postgres.test.js`; corresponding fixture updates in `tests/warehouse-photo-intake.test.js`, `tests/warehouse-product-isolation.test.js`, `tests/integration/warehouse-product-isolation-postgres.test.js`; and this report. The root agent added the shared descriptor in `services/legacyBusinessSurface.js`. No production schema, global auth, Telegram route, provider contract, HR/payment, shared menu/router/theme or dependency changes were made. Existing cumulative changes elsewhere were preserved.
