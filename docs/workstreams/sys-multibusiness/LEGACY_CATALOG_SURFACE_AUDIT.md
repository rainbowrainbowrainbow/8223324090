# D-02: legacy catalog ownership and containment audit

Date: 2026-09-12. Read-only source inspection; no production connection, provider call, runtime edit, migration, or data mutation.
Worktree: `C:/Users/Plotva/OneDrive/Документи/EventGenix/.worktrees/sys-mb-auth-p0-20260912`.
Git base: `a5180def01a1e47f8f4fc75e2f7a43092f205828`. The cumulative local implementation is preserved.

## Finding and decision boundary

The legacy design catalog is a global namespace. None of its nine tables below has a declared organization/business ownership column. A valid Park/Dar membership and a matching operational role currently reach global catalog rows: authorization knows the caller's business, while the catalog queries do not know the records' business.

This is distinct from the business-owned graduation constructor and the payment product catalog. Migration 355 assigns ownership to `graduation_*`, not to `catalog_definitions` or `catalog_pages`. The global catalog with ID `graduation` is not evidence that all similarly named graduation records have the same owner.

Park branding and seed descriptions show historical intent, but do not prove ownership of later operator-created catalogs. `created_by`, `updated_by`, `changed_by`, names, catalog IDs, image paths, and arbitrary JSON metadata are not authorization boundaries. The repository has no approved `shared` catalog flag. Do not auto-assign every row to Park, the first organization, a creator account, or all businesses.

## Actual schema

| Table | Durable identity / relation | Ownership evidence |
| --- | --- | --- |
| `catalog_definitions` | Global `id VARCHAR(50)` primary key; active/status flags; global public token | No owner; no business-qualified uniqueness. |
| `catalog_subcategories` | Serial ID; catalog FK with cascade | Inherits only a global catalog ID. |
| `catalog_items` | Serial ID; catalog FK; global price/status; `created_by` text | No owner; free-text subcategory and `extra_data` do not constrain ownership. |
| `catalog_settings` | Catalog ID primary key and FK | One settings row for each global catalog. |
| `trend_proposals` | Serial ID; catalog ID text; generated item ID | Neither catalog ID nor generated item ID has a declared FK in migration 093. |
| `catalog_pages` | Serial ID; catalog FK; unique `(catalog_id, page_number)` | All page identity and active flags are global. |
| `catalog_automations` | Serial ID; nullable catalog FK; assigned role string | No actor/business ownership; role string is not a membership. |
| `catalog_page_history` | Serial ID; nullable page FK; version, changed-by text | Version history inherits the same global page. |
| `catalog_image_blobs` | Filename text primary key; binary, source URL, JSON metadata | No catalog/product/organization FK; one public filename namespace. |

Sources: migrations `093_catalogs.sql`, `127_catalog_pages.sql`, `135_catalog_enhancements.sql`, `136_catalog_automations.sql`, `276_catalog_image_blobs.sql`. The repository scan found no later ownership ALTER for these tables. This is repository evidence, not live schema attestation.

Public tokens have an index, but no expiry, organization binding, uniqueness constraint, or revocation ledger. Generating a new token replaces the previous one. `server.js:630` checks ID plus token, but not `is_active` or ready status; page reads check page activity. Public sharing policy therefore needs an explicit decision before changing existing links.

## Complete entrypoint inventory relevant to containment

| Surface / candidate file | Current behavior | Minimum containment candidate; compatibility impact |
| --- | --- | --- |
| `routes/catalogs.js:70-1008`, mounted at `server.js:302` | Definitions, items, pages/history, settings, trends, demand stats, sharing, automations and generation. Individual role guards; no business filter anywhere. Reads include direct item IDs and catalog/page-number IDs. | One shared ownership-availability guard at router entry, before every handler/DB/provider operation. Membership-mode requests must not access unclassified legacy data. Keep the existing role/action gates; do not substitute platform role. This deliberately makes the whole legacy engine unavailable in membership business contexts until ownership is resolved. |
| `routes/products.js:1323-1400`, `GET /api/products/catalogs` | Park-only global definitions/pages/items query; other businesses currently return an empty list. Graduation fallback counts are business-scoped. | Separate global legacy entry reads from the scoped graduation fallback. Apply the same guard to the legacy read; do not disable `/api/products` or the graduation constructor. An empty result must not silently claim there are no catalogs when the real state is not migrated. |
| `routes/dashboard.js:1581-1587`, `GET /api/dashboard/widgets/catalogs` | Global definition/count and recent item/name/price/image reads. | Suppress the legacy source before querying for membership contexts and return the established unavailable/error representation. Blocking `/api/catalogs` alone does not protect this path. |
| `routes/dashboard.js:1775-1789`, widget `content_pipeline` | Global catalog definition list inside a multi-source widget. | Suppress only catalog data and mark its source unavailable; do not broaden this task into Art content ownership. Other global Art sources remain a separate explicit inventory item. |
| `services/omniLeadAssistant.js:1424-1452` | `loadCatalogItemMaterials(sourceConfig)` loads all active legacy items without business input. `getLeadAssistantSalesContext` passes business context to product sources but not catalog items. | Apply the registry-aware availability check before selecting legacy materials and before building provider prompts. Return a source-unavailable diagnostic while retaining scoped product sources. Context-only/background callers need a trusted configured-business lookup; `user.role` alone is insufficient. |
| `routes/omnichannel.js:714-741`, sales-context GET and script-test POST | Alternate direct sales-material response and provider simulation use the same helper; the test currently forwards the request body alone. | Propagate authoritative request context to both, preserve existing auth, and test direct GET as well as AI analysis. This route file is a containment candidate even though its URL contains no `catalogs` segment. |
| `server.js:627-670`, public `/catalog/:slug/:token` | Global definition/pages rendered without authentication by intentional bearer link. | Separate public-link policy decision. An authenticated router guard cannot protect already issued URLs. Preserve or revoke/reissue under an approved public/private classification; do not silently change hosting/auth or revoke all links in this patch. |
| `server.js:179-183`, `services/imageStorage.js:281-352` and upload static surface | Public blob lookup by filename followed by legacy static fallback; one-year public immutable cache. Same storage is also used by product/menu images. | Inventory incoming references and decide public asset policy. An API guard cannot retract existing images or external copies. Do not apply a blanket authenticated guard to this shared path: it would break product/menu/public catalog images. |
| `services/scheduler.js:2098-2166`, scheduled `checkStaleCatalogImages` | Actorless daily global scan, KIE generation/polling, global image URL updates. Global dedup key. | Must receive its own explicit legacy maintenance policy. Membership HTTP guards cannot constrain this writer. Either approved legacy-only continuation or a targeted pause of this job; do not change scheduling/provider settings during read-only preflight. |

The server already applies API authentication and the central business-scope write guard (`server.js:256,267`). These gates are necessary but cannot infer record ownership absent from these tables.

## Provider and side-effect boundaries

- `routes/catalogs.js:245,294,323,399,966`: shared KIE account; image/cover/reference/batch generation. `:277` polls arbitrary supplied task IDs using the same provider credential; no durable task-to-user/business/job ownership registry is written. `:388` returns shared account balance. Block membership access before any provider request, including GET polling/balance.
- `:360,424`: apply image/cover polls the provider, downloads the result through `imageStorage`, writes public blobs/files and mutates global item/definition/page rows. Task ID and destination ID are not bound to one authorized generation operation.
- `:635-673`: trend analysis calls the unified `chat_ai` provider using global configuration, then creates global proposals and changes settings. Generated prices are not an ownership signal.
- `:451`: sends catalog content via configured Telegram destination. `:504`: publish inserts a catalog item and a `price_rules` row, then creates a task; business context is not passed to these side effects. `:934`: automation runs create role-assigned tasks without an explicit business context. These are external/operational mutation surfaces, not merely catalog formatting.
- `:609-615`: GET settings inserts a missing settings row. A mutations-only guard is insufficient even before provider polling is considered.
- `:558-578`: demand statistics join global bookings by pinata/costume text without a business predicate, so this endpoint also exposes cross-business booking counts. Blocking only item/page details leaves this leak.

## Frontend consumers and visible impact

- `js/programs-page.js:2110` -> `js/api.js:3464` -> product catalogs. The helper currently converts errors into `[]`; a future not-migrated result needs an explicit unavailable state to avoid a misleading empty-catalog screen.
- `designs.html:1777-2743` contains the generic catalog list/editor, page CRUD/reorder/history-related flows, public sharing, generation polling, automation and bulk operations. `js/catalogs.js` also launches generation/publish/recent-item/share actions. Both entry paths require the same unavailable UX; disabling one button is not containment.
- `js/designs-page.js:1370-1530`: the graduation viewer reads `/api/graduation/packages`; generic viewers read `/api/catalogs/:id/pages`. Preserve the former while containing the latter. The graduation print route uses its own token/auth and business scope.
- `services/omniLeadAssistant.js:2004-2021`: script-test/simulation also builds sales materials and calls the provider. Unlike conversation analysis (`:1973`), it passes no business context to `getLeadAssistantSalesContext`, so the helper defaults to Park. Include this alternate caller in the containment proposal and propagate an authoritative context; do not protect only the live-conversation analysis method.
- Dashboard catalog widgets and Omni material sources must not display stale previously loaded global values after a business switch or unavailable response. Existing session/context generation protections do not replace clearing a source's result state.

## Proposal, not an implemented policy

Recommended interim choice: mark legacy catalog ownership `not_migrated` for membership-mode operational access and contain all authenticated routes plus alternate consumers together. Return the agreed machine-readable unavailable reason; do not produce fake empty data. Preserve explicitly authorized legacy compatibility access with a documented limitation: a user who legitimately retains a legacy business role may still access that same global legacy namespace through the compatibility context. Context switching must not be represented as complete global confidentiality.

This is a containment milestone, not ownership migration. Public bearer links, public assets and background maintenance require separate decisions because there is no caller membership to evaluate. Preserve them only as explicitly accepted legacy/public surfaces, or authorize a bounded pause/revocation plan. Do not silently infer permission from `membershipEnabled` for an unauthenticated/background request.

Alternative requires a product decision and durable model first: classify specific catalogs as business-owned or approved shared templates, define who may maintain shared templates, then migrate ownership and generation-job identity. It is unsafe to implement that classification solely from existing slugs or creator names.

No runtime guard is added by this audit. Root owns the final shared policy and counts-only preflight.

## Decisions needed before cutover

1. Which existing definitions/items/pages are approved shared material, and which belong to a named organization/business? Who resolves unmatched records?
2. Are copied templates independent business data or references to centrally maintained shared data? Who may edit the central source?
3. Are already-issued public links and images intentionally public after cutover? Must inactive/draft catalogs remain shareable, or should access end?
4. May the actorless legacy refresh job continue while membership catalog access is unavailable? No owner can currently be proven from its source rows.
5. How should provider billing, generation tasks, generated assets, price-rule creation and task ownership attach to the future business? API keys and hosting settings stay outside this task.

## Required checks for the implementation proposal

- Actual HTTP, fresh membership auth: Park and Dar manager/director/creator-business roles cannot read or mutate legacy definitions/items/pages/settings/history/automations; no fallback to the platform/global user role. A temporary creator lease cannot imply durable catalog ownership.
- Denials happen before catalog queries, GET-settings INSERT, KIE create/poll/balance, image download/storage, unified AI, Telegram, price-rule insertion or task creation. Assert zero calls, including invalid destination IDs.
- Alternate reads: product catalog entrypoint, both dashboard branches, and Omni sales materials cannot leak fixture names, prices, IDs, token fields, prompt material or counts. Scope aliases and aggregate requests must not reopen them.
- Authorized compatibility fixtures retain established response shape and role checks. Mixed membership/legacy access has an explicit tested limitation; it is not described as fully isolated.
- Business-owned graduation packages/viewer/export and business-scoped products remain usable. Generic catalog unavailable state clears stale content, supports back/refresh, and does not replace graduation content.
- Public token/asset and scheduled-job behavior follows the chosen policy, independently of API guards. Without that choice mark these scenarios DECISION_REQUIRED, not PASS.
- Future migration checks: table/column existence, global uniqueness collisions, orphan parent/page/job references, active public-token counts, and image-reference coverage. Counts only in preflight; no item text, URLs/tokens, provider payloads or blobs in reports.

Nearby existing suites: `tests/products-demo-catalog.test.js`, `tests/products-demo-graduation.test.js`, `tests/dashboard-widgets.test.js`, `tests/dashboard-widgets-recovery.test.js`, `tests/omni-lead-assistant-materials.test.js`, `tests/omni-lead-assistant.test.js`, `tests/image-storage.test.js`, `tests/scheduler-static-jobs-behavior.test.js`. These do not yet prove multi-business legacy catalog ownership. Shared-surface checks implicated by later code changes: auth/API surface, storage surface, scheduler surface; do not update their manifests solely to make checks pass.

## Explicit exclusions

`services/payments/catalogSaleService.js` is a distinct payment product catalog: it reads business-scoped `products` and discount rules with payment authorization. Do not block it by the word "catalog" or change payments in this task. Product/menu public images share catalog blob storage and require preserved compatibility. HR, Telegram integration behavior, provider credentials, hosting settings, prices/formulas and migration execution remain outside this audit.

Other image-blob writers confirmed by source scan: `services/menuPhotoGeneration.js:184`, `services/menuImageDrafts.js:409`, `services/programIconGeneration.js:472`, and `services/hermesJobs.js:1263`. They are not legacy `catalog_items` writers; blanket changes to `imageStorage` would affect their product/content flows too. Inventory their asset references before choosing an asset ownership migration.
