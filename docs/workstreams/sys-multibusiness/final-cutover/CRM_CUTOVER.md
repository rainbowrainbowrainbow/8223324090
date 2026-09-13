# CRM sales business: cutover preparation

Date: 2026-09-12. Branch: `codex/sys-mb-final-cutover-20260912`.
Source checkpoint / HEAD: `047e77fe4e15d36e0161f458632c4368583b0178`.
Status: **PREPARATION_ONLY / BLOCKED_BY_TASK7_HOLD_AND_MAPPING**.
CRM membership/owner mapping: **UNPOPULATED / NOT_APPROVED**.
No database counts, production registry status, owner identity or live usage were
collected. This document contains repository evidence and proposed verification,
not an executed migration, API call, owner decision or production authorization.

## Meaning of CRM and current source evidence

`crm` is the distinct built-in business key named **CRM продажі**, with aliases
`crm_sales`, `sales_crm` and `срм` in `services/businessContext.js:39–59`; frontend
compatibility metadata mirrors it in `js/api.js:649–669`. It is not the entire
EventGenix CRM application, the sales-funnel page, a legal/fiscal entity, Omni or
the shared `/api/crm-assistant` endpoints. A task label such as `crm_sales_followup`
or Hermes event `source:'crm'` does not prove `business_context='crm'` ownership.

| Surface | Current implementation and cutover consequence |
| --- | --- |
| Legacy business access | `services/businessContext.js:106–127,198–246` combines role/roles/extra roles. Only a role set containing creator or director can use the legacy context switch. Explicit user context arrays then narrow the allowed keys; an empty switch-capable assignment falls back to all built-ins. A plain manager/animator with raw `crm` in its array is not proof of effective CRM access. |
| Defaults and forced context | `businessContext.js:249–299` resolves explicit allowed defaults/forced context, then built-in fallbacks. Non-switch legacy actors are forced to Park. Historical migrations 226,229,230,234,257 changed arrays/defaults; especially migration226 included vice_director/senior_manager, while current effective switch policy is narrower. Inspect current persisted values and the real resolver, not historic migration intent. |
| Membership authority | `services/businessMembership.js:50–141` reloads active organization/business memberships and registry on each request. A business uses membership authority only when its actual registry row has `access_mode='membership'`. An absent/compatibility CRM row still takes the legacy path. This is a source rule, not a claim about today's production row. |
| Active principal | `businessMembership.js:144–179` replaces operational role, extra roles and page/action overrides from the selected membership, retaining platformRole separately. `middleware/auth.js:299–315` loads the current account and memberships, resolves scope and applies operational module gates. JWT identity alone is not the permission source. |
| No operational context | `middleware/auth.js:148` preserves explicitly listed account/security/profile/lifecycle reads when no operational cabinet is available. Preserve these recovery/profile exceptions; do not treat them as a CRM operational grant. |
| Organization isolation / aggregates | `businessContext.js:350–430` requires one registered organization for aggregate contexts and matching permission signatures; aggregate writes are unavailable. After CRM cutover, cross-organization or mixed-permission aggregates must deny rather than borrow stronger Park/CRM roles. |
| Built-in provisioning gap | `routes/organizations.js:69–142` allows the first permanent platform creator bootstrap and creates only Park/Dar. `services/organizationLifecycle.js:181` rejects built-in context keys through ordinary business creation. Neither endpoint is a CRM attach/cutover API. Do not rerun bootstrap, rename another business to CRM or use a custom alias to claim the legacy partition. |
| Actual schema | `db/migrations/357_organizations_business_memberships.sql` creates empty organization/business/membership tables and defaults access_mode to compatibility. It assigns no CRM owner or member. At this checkpoint migration356 is `356_omni_whatsapp_channel.sql`; old conversations referring to membership migration356 are historical. Do not reuse an occupied migration number. |
| Cabinet/branding | `services/businessCabinet.js:55,63–115,277–292` reads `business_cabinet:crm` and otherwise derives a no_timeline/dashboard fallback because the CRM built-in module list has no timeline. `businessProfile.js:74–118,160–200` uses configured registry modules in membership mode and operating-profile compatibility otherwise. CRM does not have its own distinct page route. |

### Page/action model is shared, not a CRM-specific role table

`config/permissionRegistry.js:10–57` defines the canonical role order/groups;
`services/accountAccessPolicy.js:18–28` derives page/action presets. Effective
capabilities at `accountAccessPolicy.js:251–292` apply explicit deny first, then
allowed explicit grants, then role presets. Non-delegable actions use primary
role and ignore explicit allow; they cannot be assigned through an override.
The active membership must preserve both positive and negative overrides and
canonical page/action aliases, not only its primary role.

Relevant default page permissions from that registry:

| Page or action | Default role scope; additional boundary |
| --- | --- |
| `/dashboard` | All defined roles; data remains scoped to the active business. |
| `/tasks`, `/chat`, `/staff` | All defined roles except waiter. A page preset does not override business-module or legacy-domain containment. `/kleshnya` is a page alias of `/chat`. |
| `/customers` | creator/director/vice_director/senior_manager/manager plus accountant/art_director/marketer/it_specialist/hr/admin/reception. |
| `/sales-funnel` (`/leads`) | creator/director/vice_director/senior_manager/manager/marketer. |
| `/omni`, `/copilot`, `/center` | creator/director/vice_director/senior_manager/manager. Omni API additionally checks `/omni` capability in `routes/omnichannel.js:67`. |
| `/finance` (`/analytics`) | creator/director/accountant. `view_revenue` has a broader preset, so page permission and revenue permission are not interchangeable. |
| `/reports` | creator/director/vice_director/senior_manager/accountant. |
| `/content` | creator/director/vice_director/senior_manager/manager/art_director/marketer. |
| `/hr` | creator/director/vice_director/senior_manager/manager/hr/admin/security. |
| `manage_accounts`, `manage_settings` | Primary creator/director only; non-delegable. Settings is also a module/control surface, not evidence of a separate `/settings` page grant. |
| `view_revenue` | creator/director/vice_director/senior_manager/manager/accountant; delegable subject to deny. |
| `export_data` | creator/director/vice_director/senior_manager/manager; delegable subject to deny. No exports are authorized by this preparation. |

## Separate read-only CRM preflight

All rows/counts below are **NOT_COLLECTED**. Request only the explicit read-only
data scope necessary for the future preflight; do not use production secrets or
database credentials merely because the source audit is complete. Record a
consistent snapshot, source SHA, collection completeness and sanitized aggregates;
missing schema/privilege/telemetry is NOT_TESTABLE, never zero.

1. **Registry and principals:** the literal CRM row if present, organization ID,
   access mode/status, modules and existing memberships. For every potentially
   relevant account record raw role/extra roles, active state, stored contexts,
   stored default, page/action allow and deny lists, organization memberships and
   business defaults. Compute effective CRM access with the current server policy;
   distinguish explicit access, implicit switch-role fallback, raw-only assignment,
   revoked/inactive access and aliases. Keep identity details in the restricted
   mapping artifact, not public reports. No username-based owner selection.
2. **Ownership and references:** count literal `crm`, its aliases, NULL/empty,
   unregistered and conflicting contexts separately for customers/children/tags,
   leads/cards/interactions/preferences/customer links, tasks/dependencies/owners/
   observers/history, reports, finance references/transactions, and any unexpected
   products/bookings/warehouse records. Trace both parents for each link before
   deciding ownership; timestamps, contact matches, shared user ID, amount or
   task label do not authorize reassignment. Keep negative evidence for domains
   not enabled in the CRM module list instead of assuming they contain no data.
3. **Communications:** inventory CRM-scoped Omni conversations/messages and their
   customer/lead/booking references; provider connections, external IDs, account
   bindings, route context and queued/retry/delivery ownership. Collect sanitized
   IDs/status/counts, not secrets, message bodies or connection verification calls.
   A shared human login does not prove shared provider account ownership.
4. **Legacy/public/jobs:** enumerate public catalog/token/asset references and
   actorless jobs consumed from CRM workflows without publishing/revoking anything.
   Reuse OWN-01–08 contracts and explicitly record their pending decisions. Do not
   copy D06 deliberate corrupt-record sentinels to production.
5. **Defaults/settings/usage:** inspect persisted `business_cabinet:crm`, effective
   enabled modules/start page, raw stored defaults versus resolved fallback and
   any CRM account integration options. Define complete resolver-mode telemetry
   across HTTP, WebSocket, services, jobs and providers; no quiet request log is
   evidence of zero compatibility usage.

Existing `scripts/audit-multibusiness-ownership.js:5–25` is a useful read-only
legacy catalog/template/finance reference collector, but it is not a complete
CRM users/leads/communications cutover preflight. Its table coverage and readiness
HOLD must remain explicit. `services/leadCustomerAudit.js:58–63` normalizes CRM
aliases but treats empty context as Park; preserve the original raw context in
the new evidence rather than using that normalization as historical owner proof.
Migration227 copied scoped finance references to CRM; those seed copies alone do
not establish real operational ownership or justify new financial writes.

## Membership mapping constraints

Mapping remains **UNPOPULATED**. It must separately bind the existing CRM
partition to an explicitly approved organization and real owner workflow, then
list each user ID, effective old access evidence, proposed organization role,
business role/extra roles, page/action grants and denies, active/default state,
and a no-expansion comparison. Do not assume CRM belongs to Park/Dar's organization
or create its owner from a role/username. Preserve other businesses' roles and
defaults unchanged.

The schema makes `businesses.context_key` globally unique: one literal `crm`
partition can belong to one organization record. If approved historical evidence
shows mixed ownership, a per-record separation/new-context plan is required;
duplicating `crm` into several organizations or picking the first owner is not a
valid migration.

For an existing platform creator, an operational CRM membership role is an
explicit mapping choice: the normal lifecycle API rejects role/extra role creator
(`organizationLifecycle.js:34–47`). Do not blindly copy a global creator preset,
strip deny lists or grant management actions to compensate. Any intentional new
CRM access for a manager/marketer previously blocked by compatibility is a
separate business permission change, not a no-expansion migration.

The current CRM compatibility catalog contains 15 module IDs. Its parity-safe
intersection with the current registry is only seven candidates:
`dashboard, tasks, customers, leads, omni, finance, settings`.
`chat, reports, copilot, staff, hr, content, kleshnya, center` are the eight
NOT_MIGRATED descriptors. `timeline, programs, warehouse, graduation` are absent
from the CRM built-in list; enabling them is an additional product/access decision.
The actual persisted cabinet may narrow the list further. Module selection must
therefore use effective preflight evidence and explicit approval, not copy all
`CORE_MODULES` or the old 15-item array into a supposedly migrated cabinet.

## Phased migration, replay, partial state and rollback design

This is proposed implementation scope only. No migration file or cutover tool is
created here, and no existing migration number is assigned to the future work.

1. **Prepare:** close Task7 prerequisites and relevant enabled-domain blockers;
   populate/sign the CRM mapping and before-state inventory. Build a guarded
   operator workflow for attaching the reserved `crm` partition to the approved
   organization, since ordinary create/bootstrap cannot do it. Keep the old
   compatibility policy available until the distinct cutover gate passes.
2. **Stage without widening authority:** use current schema if sufficient. Lock
   organization ownership in the established order; validate active organization,
   target users, last-owner invariant, unique context and exact before hashes.
   Stage only approved registry/membership records. Setting `access_mode` to
   compatibility is not a magic no-op: adding memberships can affect default
   selection and organization sets, so test staging effects on all existing
   sessions/other businesses or stage in a separate restricted plan artifact.
3. **Flip atomically:** only after the role/module/ownership checks pass, apply
   the approved CRM membership authority with exact change receipts. Do not infer
   ownership for unassigned operational rows or migrate providers, public assets,
   HR, payments and Art as side effects of the registry flip. No destructive
   schema cleanup or compatibility removal in this patch.
4. **Replay / partial state:** identical completed inputs produce an explicit
   no-op; conflicting owner/context/status/default/grant or changed before hash
   fails closed. Test no registry row, compatibility row, partially created
   members, pre-existing inactive membership, completed membership cutover and
   concurrent last-owner/member updates. `ON CONFLICT DO NOTHING` is insufficient
   if it silently ignores mismatched grants or organization ownership.
5. **Rollback preflight:** compare the exact live/current state and recorded
   cutover effects before any reverse action. Restoring compatibility may reopen
   global-role access; old code may ignore memberships. An earlier code SHA or
   `access_mode='compatibility'` alone is not a safe rollback. Define a reviewed
   access-safe hold/forward repair or exact restoration, including memberships,
   defaults, module visibility and queued jobs. Preserve post-cutover records,
   audits and other businesses; no broad deletes or blind schema drop.

## Communication and provider boundaries

User-facing Omni is a shared module with context-aware handlers, not the CRM
business itself. `routes/omnichannel.js:67–99` validates the authenticated UI
context; `services/omni-hub.js:552–728` and `customerCommunicationHub.js:44,172`
scope linked customer/lead/booking queries. These are reusable paths, not a CRM
cutover certificate. Add actual CRM foreign-ID, different-role and revoke tests.

Provider webhooks are intentionally machine-authenticated rather than business
memberships. `routes/omnichannel.js:98,149–182,227` chooses context from the request
and verifies the relevant provider secret/signature; missing context follows the
generic Park fallback. `services/omni-accounts.js:38–44` enables ordinary environment
fallback only for Park by default; `:382–397` has an explicit Telegram bridge
context exception. CRM normally requires its own stored provider connection and
`publicWebhookUrl` at719–730 adds `business_context=crm`. Those are configuration
rules, not evidence any CRM provider is currently connected. Never repoint or
reverify a live webhook as part of this read-only preparation.

Revoking a human CRM membership does not inherently revoke webhook credentials,
pause actorless ingress, cancel an outbox job or reassign a provider destination.
Each needs approved ownership, request/destination binding, idempotency and
replay/retry tests. Preserve existing independent auth contracts. Public links,
static/blob assets, secret bridges and operator jobs remain governed by their
separate contracts; no automatic publication, revocation or job pause.

`services/legacyBusinessSurface.js:27–41` allows shared catalog/template/recurring/
chat/Kleshnya legacy surfaces only in server-resolved pre-cutover Park. Explicit
CRM is denied even while CRM itself is in compatibility mode. The catalog's chat
or Kleshnya label does not grant the underlying data. D05 WebSocket/task guards
are separate recipient checks; CRM needs its own actual socket coverage.

`/api/crm-assistant` is an application-wide AI/audio route mounted at
`server.js:349`. `routes/crm-assistant.js:123,170–204` authenticates and calls
`services/dashboardAssistant.js`, separately from the Kleshnya legacy guard. Its
name is not a CRM ownership boundary: review data acquisition, context/principal
handoff and provider calls before any CRM AI certification. No exposure through
this path was executed or claimed by this source audit.

## CRM domain and readiness matrix

All actual CRM cutover acceptance below is **NOT_TESTABLE / NOT_EXECUTED** until
the approved local fixture and mapping exist. SUPPORTED describes reusable source
capability; it does not override Task7 HOLD or count as live PASS.

| Domain | Current source status | Required CRM acceptance before release |
| --- | --- | --- |
| Profile/membership/defaults | SUPPORTED generic resolver; CRM cutover API missing | CRM ordinary roles versus global roles, two organizations, missing/default selection, active/inactive registry, immediate revoke/role change, permissions aliases/deny, same-JWT HTTP and browser. |
| Dashboard/tasks/customers/leads | SUPPORTED scoped paths; CRM-specific cutover unverified | Own CRUD and foreign-ID denial in services/transactions, failed parent update/rollback, child/link/assignee ownership, aggregate permission parity, late responses/cross-tab. No provider notification side effects in local fixtures. |
| Finance | SUPPORTED scoped core; protected integrations excluded | CRM account/category/transaction references and revenue/page/action differences; foreign read/write denial. No payroll, payments, ledger backfill or real money actions by this plan. |
| Omni/customer communications | LIMITED | Separate CRM channels/conversations/messages/links and actor scope; forged foreign references, revoke, ingress/delivery/retry ownership, and machine auth tested with local providers only. |
| Chat/Kleshnya/legacy catalogs/templates/recurring | BLOCKED containment for CRM; NOT_MIGRATED domain | Confirm explicit unavailable UX and HTTP/socket/service denial. Opening the domain requires its own ownership migration, not a menu change. |
| Reports/copilot/staff/HR/content/center, payments/Art and other protected mounts | NOT_MIGRATED / BLOCKED certification | Inventory each enabled route/service/background entry and either prove reviewed containment or complete its separately authorized migration. Module descriptors do not disable every mounted API. D06 direct-read failures remain relevant. |
| Timeline/products/warehouse/graduation | Outside current CRM module parity | First decide whether CRM needs these modules; then separate ownership and module-specific acceptance. An existing row or a generic route alone does not authorize activation. |
| Public assets/jobs/provider bridges | BLOCKED by ownership/destination decisions | Exact owner/library/public-link policies, job/asset destination and replay boundaries; no inference from CRM labels or user account. |
| Compatibility usage | NOT_TESTABLE complete telemetry | Durable resolution-mode counters over all entrypoints and an approved observation window/traffic minimum. Zero observed events with missing instrumentation is not zero usage. |

`tests/integration/business-membership-postgres.test.js:299–312` contains a limited
CRM **compatibility** control: explicit CRM remains accessible to an authorized
legacy director while a restricted animator is denied. This test source is useful
as a regression control, not a CRM membership cutover or live PASS. The final D06
actual-app fixture did not include a CRM actor/domain matrix.

## Independent CRM release prerequisites

Task7 remains HOLD at this checkpoint. Do not release CRM before the required
Park/Dar stabilization, approved populated CRM mapping, closed enabled-domain
gaps and green CRM-local tests. Recheck current production branch/SHA/Railway
target; bind a new exact candidate/migration/auth/QA/rollback manifest and current
authorization (maximum 6 hours / 3 attempts), then exact-SHA CI, repository Railway
helper, live version proof and approved live QA. None of those actions occurred
in this preparation.

Use the separate `../RELEASE_QA_PLAN.md` caveats before proposing production
fixtures: the old 23-entity plan lacks complete side-effect/retention handling and
the standard controller supports only timeline/canary. No fixture writes, account
creation, owner promotion, Telegram/provider job, finance entry or broad cleanup
is authorized here. Keep real IDs/mapping/credentials out of public reports.

`CRM_CUTOVER_READY=false`, `CRM_COMPATIBILITY_REMOVAL_READY=false` and
`GLOBAL_MODEL_COMPLETE=false`. Remove compatibility only after independent
successful CRM and Maysternya cutovers plus complete sufficient usage evidence;
deprecated DB-field cleanup remains a separate approved migration.
