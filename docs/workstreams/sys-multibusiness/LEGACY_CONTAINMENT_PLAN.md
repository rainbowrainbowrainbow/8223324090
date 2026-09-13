# D-02 — Concrete containment and ownership handoff

Date: 2026-09-12. Based on `a5180def01a1e47f8f4fc75e2f7a43092f205828` plus the verified cumulative SYS-MB worktree. This refines existing D-02; D-03–D-06 remain the original follow-up tasks.

Implementation update: the user's continuation accepted the recommended temporary restriction, including non-Park compatibility contexts. C1/C2 are implemented locally; see [LEGACY_CONTAINMENT_IMPLEMENTATION_REPORT.md](LEGACY_CONTAINMENT_IMPLEMENTATION_REPORT.md) for verification and limitations. No production delivery, historical owner assignment, public-link revocation or background-job policy is authorized by this update.

## Decisions and rationale

**Recommended target model, not an assignment of existing data:** operational catalogs, reusable booking presets and recurring series belong to a business. If an organization-wide template library is needed, make sharing explicit and create independent business copies for operational use. One owner may control several businesses, but workers, prices, schedules and operational records still need separate business boundaries. Existing names, slugs and creator roles cannot decide historical ownership.

| Open decision | Recommended direction | Why / remaining input |
|---|---|---|
| Temporary access while ownership is absent | Explicit unavailable state for unclassified global private surfaces in membership and non-Park compatibility contexts; retain only valid single pre-cutover Park compatibility with its existing RBAC | Prevents the CRM/MD context switch from bypassing the same global data boundary. This narrows current behavior and requires acceptance of the feature interruption. |
| Existing catalog/template/series owner | Explicit reviewed mapping to a business; unmatched/mixed records remain unassigned and inaccessible | A creator, product reference or one existing occurrence does not establish ownership. Counts-only preflight identifies the amount of unresolved work, not the mapping. |
| Shared library | Approved organization-level base templates, operational copies owned by the consuming business | Shared edits must not silently alter another business's operating catalog or series. Exact shared content and maintainers remain a product decision. |
| Public links and image URLs | Explicit public/private classification before changing access; preserve or revoke/reissue only the approved set | Private route gates cannot retract bearer links, public blobs, browser caches or external copies. Existing URLs may be customer-facing. |
| Catalog background refresh / generated jobs | Require durable target ownership or an explicitly approved legacy maintenance scope | No request membership exists in scheduled execution. Stopping or continuing maintenance affects generated images/provider usage and cannot be inferred from an API gate. |
| Salary/staff/certificates | Keep NOT_MIGRATED; handle durable roster/allocation ownership in the HR/finance domain | Filtering totals by guessed staff membership changes financial meaning. This plan contains access only; it does not change payroll calculations. |

Two viable rollout choices:

1. **Contain first (recommended):** implement the complete private gate and unavailable UX, then migrate classified data. Earlier risk reduction; legacy catalog/template/recurring/salary features are temporarily unavailable in the affected contexts.
2. **Ownership first:** leave behavior unchanged while completing classification, durable ownership and migration; release only when all paths are scoped. Avoids temporary feature interruption but takes longer and leaves the audited gaps unresolved until that release.

A third, membership-only gate preserving global access through CRM/MD is **partial containment only**. It cannot be accepted as complete isolation and does not satisfy a final cutover. The source audits discuss this alternative; the stricter recommendation above is the final proposal. None of these runtime policies was implemented by the D-02 analysis.

## D02-C1 — Private global-surface containment — P1 / IMPLEMENTED_LOCAL

**Goal:** prevent every private entrypoint from reading or mutating unclassified legacy records, with no compatibility-switch bypass.

**Files/scope:** a small shared middleware/policy helper (new file under `middleware/`); `routes/catalogs.js`; `routes/booking-templates.js`; `routes/recurring.js`; only the salary-report route in `routes/finance.js`; the legacy catalog branch in `routes/products.js`; `catalogs` and catalog-source portions of `content_pipeline` in `routes/dashboard.js`; `services/omniLeadAssistant.js`; authoritative context propagation in `routes/omnichannel.js`. Keep auth contracts in `middleware/auth.js`, `services/businessContext.js` and existing request guards; no global role, sidebar or route redesign.

**Steps/minimum changes:**

1. Confirm the temporary-access matrix below. Preserve original authentication, role/action denials and upstream aggregate-write rejection.
2. Resolve the server's actual scope and registry state before evaluating legacy availability. Missing/invalid/revoked context cannot become an anonymous or default Park fallback. Do not trust body parameters or a global creator role.
3. Apply the same availability policy before all direct catalog/template/recurring SQL, ID lookup, GET settings INSERT, room/default-resource helpers, series reads/cancellation, usage updates, generation, payroll report construction, provider polling/balance, storage, history and task/event creation.
4. Protect alternate sources too: distinguish global legacy catalogs from the already-scoped graduation fallback; keep ordinary products/graduation/booking/finance transactions operational. Suppress only the catalog part of a mixed widget/material bundle and expose its unavailable status. Do not label failed availability as a successful empty list.
5. Pass trusted context into both Omni live analysis and script simulation. The current simulation accepts body alone and defaults to Park. Internal/provider callers need an explicit trusted policy path; the lack of a user is not an exemption.

**Proposed outcome matrix:**

| Request | Outcome before domain work |
|---|---|
| No/invalid session | Existing 401. |
| Invalid/revoked/foreign context or failed membership lookup | Existing fail-closed auth/scope result; no legacy fallback. |
| Single Park/Dar/custom membership, including organization owner/platform creator | 403 with a stable surface-specific `*_not_migrated` code. |
| Authorized CRM/MD/Dar compatibility | Same unavailable result; this is the intentional compatibility restriction needing acceptance. |
| Aggregate read of global legacy surfaces | 403 unavailable; aggregate writes retain existing earlier scope denial. |
| Valid single pre-cutover Park compatibility | Original RBAC, validation and successful payloads; no new permission. Once Park is in membership mode this exception cannot resurrect it. |

**Dependencies:** D-01 fresh context/auth baseline, this preflight/inventory, accepted compatibility restriction. Public and actorless paths stay tracked by C3. Source metrics and API availability are separate concerns.

**Done when / verification:** actual HTTP with fresh DB auth exercises Park/Dar/custom/foreign organizations, owners, creators, revocation with the same JWT, explicit CRM/MD switching, header/query/body aliases, aggregate modes, direct/unknown IDs and HEAD. SQL/provider/helper spies prove zero domain work for denied paths. Cover every route in the source audits, both dashboard branches and Omni's test/live material paths. Positive legacy Park retains existing RBAC and scoped unrelated modules remain reachable.

**Live-site QA:** after separately authorized release and exact SHA verification, use approved test accounts to check unavailable states and direct API denial without generation/mutation. Empty-catalog settings GET must be denied before its write. No public token, record content or credentials in evidence.

**Risks:** this temporarily removes features, including for Park membership. Salary is protected finance/HR access; contain only the specified endpoint. No payments, payroll formula, booking mapping, public link, provider settings or whole Art-domain change is part of this patch.

## D02-C2 — Unavailable UX and context-safe caches — P1 / IMPLEMENTED_LOCAL

**Goal:** users see why a legacy feature is unavailable and cannot apply a previously loaded template after switching business.

**Files/scope:** `js/booking-form.js` template cache/load/apply/save functions; recurring control state near `js/booking.js`'s recurring submission; `js/api.js` catalog error handling; `js/programs-page.js`; `designs.html`, `js/catalogs.js`, generic-viewer branches of `js/designs-page.js`; the specific dashboard/Omni consumers identified during C1. Inspect shared helpers but preserve menu/router/theme and protected booking identity/renderers.

**Steps/minimum changes:** clear template/catalog source caches on context change or unavailable response; prevent applying cached values before `/use`; show existing-pattern disabled/empty/error states with the unavailable reason; retain keyboard/focus behavior. Guard only the legacy catalog viewer, preserving the graduation constructor and its package viewer. Do not populate protected booking fields as a fallback.

**Dependencies:** final C1 error/status contract. Ship C1/C2 as one reviewed user-visible delivery; a silent 403 or `[]` fallback is not done.

**Done when / verification:** browser fixtures load a permitted legacy template, switch context, attempt selection/save/use and confirm cache removal, no field application or request. Test delayed responses from the prior context, refresh/back/forward, 390/768/1440 and light/dark for touched UI. Scoped graduation/products still function. Run protected-source guard without updating its manifest.

**Live-site QA:** approved accounts, no operational saves or real record creation. Check context switching and visible unavailable states; fixture success is not live PASS.

**Risks:** several consumers currently swallow errors; handling only one page leaves misleading or stale results. Any necessary protected booking field/source change must be isolated with its exact approval and reproducer rather than slipped into cache cleanup.

## D02-C3 — Public and background policy — P1 / BLOCKED_ON_CLASSIFICATION

**Goal:** account for every exposure or mutation path that has no request membership.

**Files/scope:** public `/catalog/:slug/:token` handler in `server.js`; `services/imageStorage.js` and the catalog blob/static routes; only the catalog refresh function in `services/scheduler.js` and its entry in `config/schedulerSurface.js`; provider-job persistence in a later migration; operator/template backfill consumers. The recurring-booking scheduler helper is currently unregistered; do not enable it during this work.

**Steps/minimum changes:** use token/automation counts plus a controlled owner-reviewed inventory to classify existing links/assets/jobs. Define token expiry/revocation and ready/inactive behavior explicitly. Apply any pause/reissue only to the approved set. Before re-enabling generation, bind request/provider task/destination/business together; arbitrary task IDs and global destinations cannot establish ownership. Keep API keys, hosting settings and payment providers unchanged.

**Dependencies:** public sharing and legacy maintenance decisions; durable job/asset identity design depends on C4 ownership. C1 is not proof that this work is complete.

**Done when / verification:** synthetic public/private/token rotation cases, stale task IDs and foreign destinations are tested without external requests. Demonstrate which job is registered, which records it may touch, and which outputs are intentionally public. Preserve approved product/menu shared-image behavior. Record limitations for already cached/downloaded public images.

**Live-site QA:** only approved synthetic links/assets/job records inside an explicit bounded release/data envelope. Do not revoke real links, regenerate images or call providers merely to test a gate.

**Risks:** shared image URLs also serve non-catalog product/menu content. A blanket authentication wall or deleting public blobs would break unrelated flows. Unknown public classification remains a cutover blocker.

## D02-C4 — Reviewed ownership mapping and migration — P1 / BLOCKED_ON_OWNERSHIP

**Goal:** make business ownership durable and safely re-enable supported modules.

**Files/scope:** reviewed next-number SQL migration under `db/migrations/` (allocate only after inspecting the then-current migration range); lifecycle/bootstrap/admin mapping workflow; catalog/template/recurring routes and `services/recurring.js`; preflight and isolated migration tests. Existing identities/API fields must be preserved; business-qualified friendly names must not require overwriting global IDs. HR/payroll ownership is a separate approved domain.

**Steps/minimum changes:**

1. Collect the bounded preflight on a selected read-only database; resolve missing/RLS/permission evidence before drawing conclusions. Produce a restricted owner mapping outside public reports; aggregate preflight itself never emits or invents that mapping.
2. Define business-owned catalog roots and template/series owners with foreign keys, stable identifiers, explicit child ownership rules and uniqueness. Record how approved shared library material is copied/referenced; classify existing mixed/unmatched records for quarantine.
3. Apply additive/idempotent schema and reviewed mappings only. Validate both parent and business ownership in direct/service operations. Recurring generation must use the owned business/resources, not global Park constants, before re-enabling it. Validate existing linked children without changing canonical field priorities as incidental cleanup.
4. Cover generated jobs, assets, public links and dependent history/settings; remove the containment denial per module only after both ownership and consumer checks pass. Keep MD/CRM compatibility lifecycle and telemetry as the existing separate cutover work.

**Dependencies:** explicit real-record mapping, shared-library policy, C1/C2 contract, C3 exposure decisions, approved schema and protected booking/financial scope where applicable. No current migration number or production owner is inferred by this plan.

**Done when / verification:** empty, representative, partially mapped, conflicting and rerun/rollback-preflight disposable schemas pass; foreign IDs and mixed-business links cannot cross boundaries; no successful parent-less write survives. Finance amounts/prices/formulas remain unchanged. Complete module-specific tests and the existing D-06 cutover evidence gate before claiming operational isolation.

**Live-site QA:** separately authorized migration/release block, exact candidate CI and site identity, approved owner/worker fixture lifecycle, same-token revocation and denial matrix, rollback evidence. No global compatibility deletion until both later businesses cut over and measured usage reaches zero.

**Risks:** historical business ownership cannot be reconstructed safely from usernames, names, product context, default context or a subset of instances. Keep unmatched records inaccessible instead of fabricating a migration result.

## Current handoff state

- **DONE_LOCAL:** read-only collector, unit/PG verification, nine-table catalog and 17-action template/recurring inventory, alternate entrypoint analysis, concrete policy/UX/public/migration tasks.
- **IMPLEMENTED_LOCAL:** accepted C1 private restriction and C2 unavailable UX/cache safety. Historical proposal language above records the original rationale; the implementation report records the actual result.
- **BLOCKED_ON_CLASSIFICATION:** C3 public links/assets/jobs and C4 real-record owner mapping/shared-library policy.
- **READY_INDEPENDENT:** existing D-03 registry/module support analysis; it does not decide legacy owners or require executing generation/publication.
- **NOT_RUN:** production preflight, ownership migration, CI, deploy and live QA. Local implementation evidence does not count as live acceptance.
