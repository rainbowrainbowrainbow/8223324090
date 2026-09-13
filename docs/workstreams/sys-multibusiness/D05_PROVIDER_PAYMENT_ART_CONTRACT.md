# D05 — Provider, Telegram, payment and Art ownership contract

Date: 2026-09-12. Worktree: `codex/sys-mb-auth-p0-20260912`, base
`a5180def01a1e47f8f4fc75e2f7a43092f205828`. Source-only prerequisite audit
following `OWNERSHIP_DECISIONS_VERIFICATION.json` and Task 4's blocked handoff.

**Result: protected implementation BLOCKED; several registered paths remain
NOT_MIGRATED and are not proven unavailable. Full SYS-MB acceptance remains HOLD.**
No runtime, schema, secrets, settings, provider, payment, message or Art changes
were made. No live site, database or external service was accessed. Tests listed
below were inspected as evidence candidates, not executed by this subtask.

`SUPPORTED` below means the specific existing source boundary is implemented;
it is not a new HTTP/PostgreSQL/live PASS or certification of the whole domain.
`BLOCKED` describes the next protected implementation. `NOT_MIGRATED` does not
mean disabled: availability and ownership are separate columns.

## Actual entrypoints and authority

The shared JWT boundary in `middleware/apiAuthBoundary.js` excludes the custom
secret/signature paths enumerated by `config/authBoundary.js`. Those callers have
no human JWT membership to revoke. `middleware/auth.js:authenticateToken` refreshes
membership for ordinary requests and calls `requireRequestBusinessModule`, but
`services/businessModuleRegistry.js:OPERATIONAL_API_MODULES` covers only managed
operational routers. `art-director`, `telegram`, `payments` and `report-bot` are
absent from that map. Their `not_migrated/canEnable:false` registry descriptors
alone do not deny direct APIs.

| Surface / responsible domain | Source of truth; ingress, reads and writes | Retry/revocation boundary | Status and actual availability |
| --- | --- | --- | --- |
| Legacy Telegram — Telegram/task/booking owners. `routes/telegram.js:router.post('/webhook')`, `resolveTaskCallbackActorUser`, `ensureTaskCallbackStatus`; `services/bot.js`; `services/kleshnya.js:isTelegramTaskActorAllowed` | Shared webhook-secret header, then global known chats/threads and command/callback dispatch. Task lookup is by ID; active account is resolved by Telegram identity. Task owner ID or assigned username is checked. Animator callbacks use global pending requests and default timeline context. Other callbacks enter contractor/certificate/training/intake domains. | Task status guards and owner checks are real, but the callback actor query loads account roles, not task-business membership. `acknowledgeTask` reads/writes by task ID. Global account inactivity is checked for task actors; business membership revocation is not checked there. No whole-webhook durable update-ID ledger was found. Individual callback guards are not cross-business authorization. | **NOT_MIGRATED / ENABLED_PATH**, secret/config dependent; **BLOCKED** on Telegram and affected domain contracts. Do not infer that possessing a genuine callback or bot credential grants business access. |
| Legacy Telegram outbound — `services/telegram.js:notifyTelegram`, `enqueueRetry`, `processRetryQueue`; `services/notificationDigest.js`; `server.js` retry interval | Booking message-ID SQL uses the booking context. Destination comes from global `getConfiguredChatId()`. Digest admission receives text/booking/type without business. Retry item retains booking context, chat ID and rendered text. | In-memory queue, bounded attempts and concurrent-run guard. Retry calls `sendMessage(chatId,text,{retries:1})` without retained context; initial send/edit/delete also omit it. Context protects the booking UPDATE, not recipient/token selection. Neither retry nor digest revalidates business/recipient before send. Restart durability and provider-accepted/response-lost dedup are not established. | **SUPPORTED** narrow booking-UPDATE predicate; **NOT_MIGRATED / REGISTERED_WRITER** for delivery ownership. `server.js` registers retry every 30s under ordinary background startup. No job was paused. |
| Omni ingress — Omni/integration owner. `routes/omnichannel.js:webhookBusinessContext`, `/webhook/{telegram,viber,sms,meta,whatsapp,binotel}`; `services/omni-accounts.js:resolveOmniRuntimeConfig`, `publicWebhookUrl`; `services/omni-hub.js:processInboundMessage`, `applyProviderLifecycleReceipt` | Provider secrets/HMAC are validated. Request context selects a scoped `omni_provider_connections` record; generated non-Park callback URLs include context. Missing request context follows `businessContextFromRequest` to the default Park path. Park alone may use environment fallback. Disconnected/needs-rebind connection returns no runtime configuration. Conversations persist business context; provider message IDs are matched under conversation/channel/context. | Conversation creation uses business/channel/external-ID advisory locking. Duplicate inbound messages and stale lifecycle receipts have guards. Connection status is checked, but the inspected actorless ingress/runtime resolver does not join active `businesses`/`organizations` or an approved machine principal. Human same-JWT revoke protects manager APIs/streaming, not this webhook. | **SUPPORTED** existing scoped conversation/receipt and signature boundaries; **NOT_MIGRATED / ENABLED_PATH** for organization deactivation and registration authority. Operational flag/credential state was not read. **BLOCKED** before claiming full D05 support. |
| Universal/MD lead ingress — Leads + external bot owner. `routes/leads.js:handleUniversalWebhook`, `universalWebhookBusinessContext`, `upsertUniversalWebhookLead`, `handleMaysternyaBookingWebhook`, `handleMaysternyaAvailabilityWebhook`; `services/maysternyaBookingWebhook.js` | Shared universal bearer token. Universal target uses body/query/header context; known MD source labels force `maysternya_doli`. Upsert matches context/source/external ID; MD booking service retains explicit MD compatibility semantics and D04 related-record guards. No token-to-approved-business binding or active organization check exists in these handler entrypoints. | Universal uniqueness is `(business_context,source_channel,external_id)` when external ID exists; this is record dedup, not authorization of context. MD booking replay/rollback has prior D04 evidence. User membership revoke does not revoke this shared integration credential. | **SUPPORTED** limited existing scoped upsert/MD relationship guards; **NOT_MIGRATED / ENABLED_PATH** as membership ingress. Keep MD compatibility until its separately approved cutover. This audit does not reopen or rewrite D04. |
| Hermes machine ingress — Hermes owner. `middleware/hermesAuth.js:loadHermesActor`, `applyHermesBusinessContextAllowlist`, `createHermesAuthMiddleware`; `routes/hermes.js:createHermesRouter` and `routes/hermes-schedule.js` | API key plus configured actor account and optional context allowlist. Each request reloads the account; inactive account is denied; action overrides are stripped. Actor contexts/role come from account fields. Machine auth does not call `loadMembershipAccess`; downstream route/owner guards vary. | Account deactivation and integration allowlist apply. Business membership revocation/role change is not supplied by this auth path; old user context mirrors are insufficient after cutover. Existing scoped task/menu/schedule service checks must be preserved. No blanket claim that all Hermes operations bypass their own owner guards. | **SUPPORTED** account/credential boundary; **NOT_MIGRATED / ENABLED_PATH**, configured-key dependent, for the full machine-principal membership model. Exact endpoint denial matrix still required. |
| Report-bot — report-bot + finance/personal-account owners. `routes/report-bot.js:requireBotApiKey`, `/webhook`, `/submit`, `/accounts`, `/summary`, `/submissions` | Shared bot secret/API key. `/submit` creates global `report_bot_submissions`; corporate path writes `finance_transactions` without explicit business/account ownership. Personal path chooses an active personal account using Telegram owner ID and optional name. Category mapping is global. This route does not pass through the scoped `/api/finance` transaction handler. | Transaction plus submission idempotency key and duplicate lookup exist. Key does not bind an approved business principal. Human membership revoke does not affect this custom-key path. A name/Telegram ID cannot decide which of one owner's businesses receives money. | **NOT_MIGRATED / ENABLED_FINANCE_WRITER**, key dependent; **BLOCKED** on OWN-07 and financial integration scope. Do not call `/submit` for QA: it writes finance records. |
| Payments HTTP — payments/fiscal owner. `routes/payments.js`; `services/payments/fiscalAccess.js:authorizeFiscalActor`, `assertFiscalBindingScope`; `paymentService.js`, `fiscalSaleRouteService.js` | JWT/action checks, explicit fiscal profile/location/register, user cashier binding and profile access. Payment order carries business/source snapshot; fiscal bindings and immutable operation snapshots already distinguish financial entities. Park/Dar routes have deliberate constraints. CRM business and legal/fiscal profile must not be merged by assuming a shared owner. | Fresh HTTP JWT membership reaches `canUseAction`/`canAccessBusinessContext`; cashier binding and approval constraints remain. Reusable fiscal access functions consume the supplied actor; they do not independently reload memberships. Existing order/replay/worker controls need actual SYS-MB denial tests, including an active second organization. | **SUPPORTED** existing fiscal profile/binding boundary, **BLOCKED** full membership certification. Registry label `payments:not_migrated` does not disable this router. Runtime feature gates may restrict individual actions; live values unknown. |
| Checkbox callback/outbox — payments/fiscal owner. `routes/checkbox-webhook.js`; `services/checkbox/webhookService.js:loadWebhookFiscalOperation`, `handleCheckboxWebhook`; `services/payments/paymentOutboxWorker.js` | `/api[/v1]/checkbox/webhook` mounts before shared JSON/JWT, uses raw-body HMAC plus explicit webhook feature gate. Resolves exactly one stored fiscal operation/receipt, rejects claimed profile mismatch, then register-locks/reloads identity. Audit and status-lookup job use that stored profile. Worker joins job/operation/order/register/profile and validates immutable provider/configuration snapshots and current register status. | Callback event/payload conflict checks and transactional idempotent outbox enqueue; worker claims/retry state are persisted. Receipt reconciliation uses the operation's established fiscal identity, not an arbitrary webhook business parameter. Worker does not join SYS-MB organization/business membership. Revoking one cashier must not silently discard an already accepted fiscal receipt. | **SUPPORTED** narrow source-level fiscal identity/HMAC/replay boundary; **BLOCKED** on explicit deactivation/new-dispatch-versus-reconciliation policy. **REGISTERED_WORKER / CONFIG_DEPENDENT**, not proven disabled. `server.js` schedules payment worker every 30s and readiness probe every 60s. |
| Art — Art owner. `routes/art-director.js`; `db/migrations/012_art_director.sql`; `services/costumeInventory.js` consumer | Central JWT and valid selected business, but global brand/templates/content/approvals tables. Ordinary GETs have no tenant predicates; content create/update/status uses IDs and optional username; brand/template mutations have role guards. Status transition transaction validates allowed states, not business ownership. Costume subsection delegates a separate shared inventory. | No durable business owner or owned request/idempotency model in inspected Art routes. Removing one membership blocks that selected context through auth, but any remaining valid context can still reach global reads; route is not module-contained. Status `published` changes local content metadata here, not proof of a remote publish call. | **NOT_MIGRATED / ENABLED_UNCONTAINED_API**; **BLOCKED** exact Art-owner scope. `/api/art-director/brand`, `/templates`, `/content`, `/content/:id/status` are concrete candidate denial cases. This is source-confirmed reachability, not a newly executed HTTP exploit. |

## Proposed bounded patches — none authorized or applied here

All business decisions below are **PENDING** under OWN-07/08. Existing OWN-04–06
catalog/public/job decisions stay in Task 4; do not mix that migration into D05.
The exact permissions are candidates for a later block, not approval text already
received. Historical SYS-MB bootstrap/release permission does not decide these
domain contracts.

### D05-PRV-01 — Telegram identity, destination and retry

Owner: Telegram integration maintainer, with task/booking/warehouse/HR owners for
their callbacks. Scope candidates: `routes/telegram.js`, `services/telegram.js`,
`services/notificationDigest.js`, callback dispatch in `services/bot.js` and the
minimal task operations in `services/kleshnya.js`; corresponding tests. A future
durable integration/chat/delivery binding is additive schema work if no suitable
table can represent it. Do not put tenant identity into plaintext callback data
and trust it without the stored parent.

Required choice: which business owns each configured bot/chat/thread; whether one
bot may serve multiple businesses via explicit bindings; which approved machine
principal may deliver queued business notifications after the initiating human
leaves. Unknown historical chats/drafts/queues must not inherit Park automatically.

Minimum patch: resolve stored callback parent owner; load fresh actor membership
and action for that owner inside the mutation transaction; bind outgoing event,
recipient and transport context; retain that binding on retries and digest items;
revalidate before dispatch. Keep external-acceptance ambiguity explicit rather
than resending blindly. Authentication, Telegram transport/external contract,
callback/booking protected hunks and any schema need separately named permission.
No sending, webhook re-registration, secret change or live queue cleanup implied.

### D05-PRV-02 — Machine/provider registration and deactivation

Owner: Omni, Leads/MD and Hermes maintainers, executed as separate small patches.
Scope candidates: Omni webhook entry/resolver in `routes/omnichannel.js` and
`services/omni-accounts.js`, exact ingress/finalization functions in
`services/omni-hub.js`; universal-token resolution in `routes/leads.js`;
`middleware/hermesAuth.js` plus actual scoped callers. Existing provider payload
formats, signatures, sender identities and D04 relationship semantics stay intact.

Required choice: credential/connection → approved organization/business/actions;
whether provider ingestion is organization-owned automation independent of the
installer's membership; behavior for inactive business, disconnected connection,
and delayed delivery/status receipts. Missing/unknown context cannot silently
select Park in the target model. MD/CRM compatibility exceptions require an exact
bounded policy; no new custom-business provider capability is inferred.

Minimum patch: server-owned registration before inbound persistence/provider fetch,
fresh registry state and explicit job principal, business-preserving idempotency,
and membership-derived Hermes actor roles. Reject conflicting client context;
keep safe receipt reconciliation separately scoped. Add a reviewed compatibility
transition for existing webhook URLs/credentials rather than silently changing
provider routing. Permission needed: exact integration auth/authorization and
external-contract scope; any new ownership/backfill schema separately authorized.

### D05-PRV-03 — Fiscal continuation and report-bot ownership

Owner: payments/fiscal maintainer; report-bot and personal-account maintainers own
their separate ingress patch. Preserve the current fiscal state machine, amounts,
formulas, provider identity and register-lock/recovery rules.

Required choice: reviewed fiscal profile/legal entity → SYS-MB business mapping;
who may initiate a **new** provider mutation after membership/business changes;
which recovery principal must finish known pending receipts/refunds/shifts; how
the report bot explicitly selects corporate versus personal ownership. Do not
derive a legal entity from the active UI cabinet, a account name, or shared owner.

Scope candidates: narrow authorization seam in `services/payments/fiscalAccess.js`,
pre-dispatch/reconciliation guards in `paymentOutboxWorker.js`, callback operation
binding if the approved contract requires it; separate `routes/report-bot.js`
transaction/lookup changes and its durable ownership/idempotency schema. Existing
callbacks must continue rejecting profile collisions and ambiguous operation IDs.
Report-bot business/account/category validation belongs in its transaction; a
filter on the finance UI does not protect this ingress.

Permission needed: exact payment/billing/financial authorization and integration
changes, selected schema/mapping, and only synthetic local verification. Do not
reuse a general D05 continuation to mutate real payments, disable reconciliation,
change feature flags, credentials, hosting or provider webhooks.

### D05-PRV-04 — Explicit Art containment, then separate owner migration

Owner: Art maintainer. First candidate patch is a narrow unavailable guard before
Art SQL for membership contexts, plus unavailable UX only in existing Art consumers.
Legacy compatibility behavior needs an explicit choice: keep named supported
compatibility contexts or contain all unclassified access. This cannot be inferred
from the separate Park-only catalog containment policy.

After approved historical Art mapping, a later additive owner schema may cover
brand/template/content/approval history and scoped template/costume references.
Shared brand library versus independent business copy is an Art business decision;
the current account username and template author are insufficient. Reuse existing
Art UI; do not move Art into graduation or alter global menu/router/theme.

Permission needed: exact `routes/art-director.js` access/containment and affected
Art consumer scope with Art owner's handoff; schema/backfill separately. Minimum
acceptance is denial before SQL for unsupported memberships, including direct IDs
and aggregate mode. Registry labels/sidebar visibility alone cannot satisfy it.

## Future executable evidence and reopening gate

Run only against disposable PostgreSQL and loopback provider implementations with
an unexpected-outbound-call counter. No test below authorizes a real integration
call, payment, booking, message or Art publication. Tests must assert durable state
as well as HTTP errors and distinguish policy-denied from unavailable fixtures.

| Package | Required denial, ownership and retry evidence | Existing starting points, not new PASS |
| --- | --- | --- |
| Telegram | Two organizations; one user with different roles; foreign task/callback parent; inactive membership with same Telegram ID; foreign chat/thread; missing owner; pending retry after revoke; original context retained in transport and digest; duplicate/stale callback has no second write; zero sends when denied. | `tests/telegram-callbacks.test.js`, `tests/kleshnya-telegram-task-actions.test.js`, `tests/telegram-retry-queue-hardening.test.js`, `tests/telegram-digest-contract.test.js` |
| Omni/lead/Hermes machine ingress | Valid signature + foreign/conflicting/missing context; inactive organization/business; stale installer membership according to approved principal policy; identical provider IDs in two businesses; repeated delivery and late receipt; zero persistence/fetch/send before authority is established. Preserve MD opaque-code compatibility controls. | `tests/omni-provider-lifecycle.test.js`, `tests/omni-hardening.test.js`, `tests/hermes-auth.test.js`, `tests/hermes-schedule-routes.test.js`, D04 HTTP/PG suites |
| Payments | Cross-profile operation/receipt/event collision; wrong business/fiscal mapping; cashier same-JWT revoke before new dispatch; legal pending-receipt recovery after revoke under approved principal; duplicate payload vs conflicting event; immutable provider drift; no extra receipt/order mutation. | `tests/checkbox-webhook-reconciliation.test.js`, `tests/payment-outbox-mutation-boundary.test.js`, `tests/payment-outbox-receipt-mismatch.test.js`, `tests/payment-workflow.test.js` |
| Report-bot | Same external event in two business bindings; spoofed actor/account/name; foreign corporate and personal account; late retry after binding change; atomic submission/finance link, rollback and replay; zero external sends. | Existing report-bot/auth-boundary route fixtures; add actual SQL coverage for the exact approved ingress transaction. |
| Art | Direct global reads/status mutation with a valid membership JWT; deny before query when contained; later own/foreign template/content/history/costume graph; partial/failed parent writes; parallel status transition audit consistency. | `tests/art-director.test.js` is a mutable running-server CRUD suite, not membership isolation. Do not run it against production. New actual-app/PG containment checks required. |

No listed enabled gap is marked completed. Stage acceptance requires exact source
hashes, actual HTTP/service PostgreSQL denial/retry results and an approved domain
contract; deployment and live synthetic QA remain separately authorized release
work. This document only prepares those protected patches. Independent general
chat/personal-AI/income-notification work and warehouse/people-finance work have
separate D05 owners and are not modified or certified here.
