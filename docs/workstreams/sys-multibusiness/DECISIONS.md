# SYS-MB-OWNERSHIP-DECISIONS — Historical ownership and publication

Date: 2026-09-12. Status: **ANALYSIS_COMPLETE / BUSINESS_DECISIONS_PENDING**.
Migration/public-policy application: **BLOCKED_ON_REVIEWED_SOURCE_AND_DECISIONS**.

This is continuation task 3, following the verified D04 checkpoint. It proposes
decisions; it does not approve a mapping, make existing data private/public,
disable a scheduled job or authorize a migration/release.

## Evidence and authority

Worktree: `C:\Users\Plotva\OneDrive\Документи\EventGenix\.worktrees\sys-mb-auth-p0-20260912`.
Branch: `codex/sys-mb-auth-p0-20260912`.
HEAD/base: `a5180def01a1e47f8f4fc75e2f7a43092f205828`.
All **136 source and 30 artifact SHA256 entries** from
`RELATED_RECORDS_VERIFICATION.json` matched before this analysis. The cumulative
implementation remains uncommitted; HEAD is not its implementation commit.

The process-local `MULTIBUSINESS_AUDIT_DATABASE_URL` was absent. No secrets file,
`DATABASE_URL` fallback, production database, live token or provider was used.
Preflight therefore uses explicitly identified **local synthetic PostgreSQL**.
Real counts, row identities, approved business owners, public-link usage, external
asset copies and current deployed job execution remain **NOT_COLLECTED**.
`OWNERSHIP_PREFLIGHT_REPORT.md` records executed checks and bounded coverage.
Synthetic counts cannot become a production migration inventory.

### Already approved constraints

These constraints come from the user's accepted SYS-MB model, continuation rules
and this task, not from inference about database content:

| Constraint | Status | Authority and effect |
| --- | --- | --- |
| One account may join multiple organizations/businesses; operational roles differ per business | APPROVED | Accepted SYS-MB model; a common account/owner does not merge operational data |
| Park/Dar first cutover; MD/CRM retain compatibility pending their own migration | APPROVED | Accepted rollout scope; no global compatibility removal here |
| No automatic owner assignment by username, role, slug, product, room or first occurrence | APPROVED | Explicit task/common rules; every historical assignment needs reviewed evidence |
| Preserve local C1/C2 containment and prior D01–D04 work | APPROVED | Continuation common rules; no reopening unclassified private modules |
| Analysis is read-only; no production mutation, provider action or release | APPROVED | Current request/common rules; fixture setup is local and disposable |
| HR/finance/protected booking/contracts stay in separately scoped implementation | APPROVED | Existing domain ownership and protected-contract rules |

No approval for the following **OWN-01–OWN-08** business choices or any actual row
mapping was supplied in this task. A recommendation, valid JSON or a reviewer
string is not an authorization.

## Decisions to approve before task 4

| ID / status | Concrete decision and missing answer | Recommendation | Consequence / alternative |
| --- | --- | --- | --- |
| **OWN-01 / PENDING** | Which organization/business owns each existing catalog root, booking template and recurring series? Which reviewed evidence authorizes each assignment? | One business owns each operational root. Classify every root independently; verify the full child graph before children inherit that owner. Record exact source row fingerprints and a review reference. | Separate prices, schedules and employee access remain possible. An organization owner must review actual inventory. Do not use one blanket mapping for all seeds or infer ownership from a single product. Unresolved roots stay quarantined in the future migration. |
| **OWN-02 / PENDING** | Is an organization-wide library needed now, who maintains it, and which content may be copied? | Keep the first migration business-owned. Later offer an explicitly maintained, versioned organization library whose use creates an independent business copy. Copy descriptive content; select/validate business-specific products, prices and resources explicitly. | Library updates cannot silently change another business's operations. A shared mutable operational catalog would need edit/distribution permissions, tenant-specific prices/resources and update semantics; do not introduce it as a shortcut. Deferring the library reduces first-cutover scope. |
| **OWN-03 / PENDING** | How should mixed, missing-parent, conflicting and unassigned roots be handled? What happens to already-created recurring bookings? | Preserve existing operational records and their identities/known owners. Quarantine unresolved legacy roots/children from future generation/use. Resolve or explicitly split a mixed root in a separate reviewed operation; do not move historical bookings with the template. | Some legacy features stay unavailable until classification. Automatically moving a series and all occurrences could affect another business's bookings/finances. Future root copies/rebinding need their own mapping, protected booking scope and idempotency plan. No split/cancel/delete occurs in this task. |
| **OWN-04 / PENDING** | Which existing links are intentionally public, and should they keep showing live edits? What expiry/inactivation behavior is required? | New sharing should be an explicit authorized action, with private default, a fixed published revision, revocable tokens and an explicit expiry choice. Recommend 30 days as a configurable new-link default for review; campaigns requiring longer life must choose it deliberately. Classify existing links individually before preserve/reissue/revoke. | A fixed revision avoids publishing later drafts accidentally; updating it requires explicit republish. Live-updating catalogs are a valid alternative only if the owner accepts that edits immediately reach all link holders. The proposed lifetime is not approved and does not invalidate existing URLs. |
| **OWN-05 / PENDING** | Which assets are private, public marketing material or shared organization material? Which existing consumers depend on each URL? | Use explicit asset visibility and owner/reference records. Private originals use authenticated or short-lived authorized delivery; publication creates or approves a public derivative for an identified revision. Preserve classified product/menu marketing images. | Hiding the catalog API alone does not hide public images. A blanket auth wall would break public catalogs/product/menu images. Existing downloaded or immutable-cached copies cannot be promised revoked; classification must record that limit. Never label an ambiguous multi-business image private just because one parent is private. |
| **OWN-06 / PENDING** | May the currently registered legacy refresh continue, for which exact records, and who may run/poll/apply automation? | At the future cutover, default unowned jobs to disabled/quarantined, allowing only explicitly reviewed owner-bound jobs or a bounded legacy maintenance allowlist. Bind each request/provider task/destination/output/idempotency key to one business. Keep recurring scheduler registration disabled until its generator is scoped and accepted. | Pausing catalog refresh may leave older images; continuing global refresh keeps an actorless writer outside membership policy. No pause, provider call, settings change or scheduler enablement occurs now. A proposed provider-job registry is new schema work, not an existing table to map. |
| **OWN-07 / PENDING** | Which domain owner will decide staff allocation, certificates/payroll and operational/provider ingress ownership? Is any cross-business sharing intended? | Keep existing containment for unsupported finance/staff/intake references. Obtain separate HR/finance/integration contracts and domain sign-off before enabling them. User membership alone cannot assign a staff record, payroll amount, certificate or provider conversation. | A combined payroll/staff roster may need allocation rules, not a business filter. Telegram/payment/general-chat/Art scope cannot be silently transferred into catalog migration. This decision does not change amounts, formulas, staff or production records. |
| **OWN-08 / PENDING** | Which reviewed snapshot is authoritative, who approves the mapping and policies, and what evidence permits each module to reopen? | Use a bounded, repeatable read-only snapshot plus restricted exact inventory; bind approvals to source/code fingerprints. Revalidate rows, registry and coverage before a later idempotent migration. Reopen each module only after its private/public/asset/job paths and foreign-ID tests pass. | Collection success or a zero orphan count is insufficient. Partial/RLS/permission gaps, unknown public assets and unowned active writers keep the affected module on HOLD. Migration/release still needs its own current authorization and exact-candidate checks. |

Suggested review responses should identify the decision ID and chosen policy;
OWN-01 additionally requires a restricted row-level mapping from an actual source.
An answer such as “one owner owns everything” is not a mapping of business-owned
records. Any approval must be recorded with its exact scope and evidence version.

## Actual record graph and mapping consequences

| Root / dependent data | Current identity and source | Required classification before assignment |
| --- | --- | --- |
| Catalog definition | `catalog_definitions.id`, globally unique VARCHAR(50); migration 093 | Exact root → organization/business. The legacy `graduation` catalog ID is not the scoped `graduation_*` domain and cannot inherit its owner by name |
| Subcategories/items/settings/pages | Numeric child IDs or `catalog_settings.catalog_id`; catalog FKs; migrations 093/127 | Review every child under the root. Preserve global IDs and page `(catalog_id,page_number)` uniqueness. Inconsistent embedded JSON/image references must be isolated, not silently copied |
| Page history | `catalog_page_history.id` → nullable `catalog_page_id`; migration 136 | Follow a validated page and root, including historical images/details; missing parent means unresolved history, not permission to assign Park |
| Trend proposals | `trend_proposals.id`; `catalog_id` and `generated_item_id` lack FKs in migration 093 | Validate both root and generated item when present; an item in another root requires review even if the business eventually matches |
| Catalog automations | `catalog_automations.id`, nullable root, global assigned-role string; migration 136 | A missing root or `assigned_role` does not establish a business. Owner, allowed action and target must be explicit before execution |
| Catalog blobs | `catalog_image_blobs.filename`; no catalog/product owner FK; migration 276 | Enumerate actual inbound references, including product/menu/static/external consumers; filenames and `metadata` are evidence, not automatic ownership |
| Booking templates | `booking_templates.id`; product/room snapshots, creator text; migrations 075/296 | Exact root owner plus validated target product/resource. Product context and creator text are clues only |
| Recurring roots/skips | `recurring_templates.id`; `recurring_booking_skips.id` → root; migration 003 | Classify root and skips; review mixed/missing instance contexts. A skip follows only a verified owned root |
| Existing recurring bookings/linked children | `bookings.recurring_template_id` is indexed without a declared FK in migration 003; protected `linked_to` | Evidence for conflict detection only in this mapping version. Do not reassign, cancel, renumber or change protected links as a side effect of assigning a root |
| Proposed generation jobs/asset grants/library | No complete durable job/owner/publication-revision model in the inspected catalog implementation | Record required future design, not fabricated current rows/table names. These need later approved schema/contracts |

Root-level ownership cannot be established from totals alone. Preflight detects
orphans/ambiguity, but does not enumerate all embedded JSON references, inbound
file consumers or external provider tasks. `scripts/backfill-room-resource-id.js`
explicitly treats both template tables as context-free; it must not be reused to
infer their business owner.

Current `services/recurring.js` uses `DEFAULT_TIMELINE_CONTEXT` for resources,
conflict checks, generated bookings and post-commit automation. Private route
containment does not turn this service into a tenant-scoped generator. Scoping it
and protected child links is later implementation, not a read-only migration step.

## Public/private and background rules

`PUBLIC_ASSET_JOB_POLICY.md` contains the checked source/endpoint inventory,
recommended transition rules and exact future denial/retry tests for OWN-04–06.
The important distinction is:

- Private catalog operations require business membership plus the existing role/action permissions; a public token must not become a management credential.
- Public access is a deliberate publication of specified content. It must not expose draft/history/internal settings or silently bypass the owner business's inactive state under the proposed policy.
- Asset delivery has its own classification. Revoking one HTML token cannot recall a previously public image or another public consumer of the same bytes.
- Scheduled work has no request membership. Its authorized business/action/destination and retry identity must be persisted and checked independently.

These are proposed target rules. The current source still permits bearer access
to current active pages without checking definition status/activity, and exposes
shared images with long public caching. The registered global refresh is not
proven paused. Do not report those gaps as fixed by this analysis.

## Restricted mapping and preflight handoff

See `OWNER_MAPPING_FORMAT.md`, `OWNER_MAPPING.schema.json`, the clearly synthetic
example and its read-only validator. The local restricted working artifact is
unpopulated because no actual read-only source was available. It does **not** mean
the production inventory has zero rows. Git-ignore prevents accidental staging;
it is not access control or a promise of encryption.

For real data, use approved restricted storage. Store exact row identifiers and
fingerprints there, not raw names, notes, phones, tokens, signed URLs, blobs,
credentials or provider task secrets in a broadly shared report. Public artifacts
contain only aggregated outcomes and opaque evidence references.

The future operator must collect a bounded exact-ID graph from the chosen source,
review each owner/visibility decision, and bind it to the snapshot. A schema-valid
mapping cannot prove that a reviewer is who they claim, that an approval exists,
that the source is complete, or that the proposed owner is correct. The validator
does not connect to a database, execute SQL or apply assignments.

## Implementation readiness

| Follow-up | Current status | Unlock condition |
| --- | --- | --- |
| Task 3 analysis/format/fixture preflight | READY_FOR_REVIEW | Read these decisions and their evidence; no runtime change required |
| Real inventory and historical owners | BLOCKED_SOURCE_AND_MAPPING | Explicit read-only source, complete restricted inventory and reviewed per-record mapping |
| Task 4 private catalog/template/series migration | BLOCKED_OWN-01/02/03/08 | Approved policies/mapping, missing schema/conflicts resolved, separately authorized migration scope |
| Task 4 public/assets/jobs | BLOCKED_OWN-04/05/06/08 | Classified existing links/assets/job targets and approved transition semantics |
| Task 5 protected HR/finance/provider parts | BLOCKED_DOMAIN_CONTRACTS | OWN-07/domain-specific decisions and exact implementation scope |
| D04 generic linkedTo guard | BLOCKED_PROTECTED_CHANGE | Existing `LINKEDTO_PROTECTED_SCOPE.md`; this analysis grants no protected-field approval |
| Independent inventory/design work | READY | Can continue without assigning owners or running providers |
| Park/Dar release / global model complete | HOLD | No live/source/mapping/public-job certification, remaining domains and acceptance/release gates unresolved |

No runtime code, schema, access gate, provider behavior or production state is
changed by this document. The next useful owner action is to review OWN-01–08 and
provide an explicitly selected read-only source for the restricted inventory.
