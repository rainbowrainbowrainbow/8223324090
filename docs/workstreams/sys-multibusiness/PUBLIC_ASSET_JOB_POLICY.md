# SYS-MB — Public catalog, asset and job policy evidence

Date: 2026-09-12. Source checkpoint: `RELATED_RECORDS_VERIFICATION.json` on
`codex/sys-mb-auth-p0-20260912`, base `a5180def01a1e47f8f4fc75e2f7a43092f205828`.
Task: SYS-MB-OWNERSHIP-DECISIONS, supporting **OWN-04, OWN-05 and OWN-06**.

**Status: source audit complete; all future policy choices below are PENDING.**
No catalog was assigned, published, revoked, generated, downloaded or refreshed.
No scheduled job was paused or invoked. No database, live site, provider, secrets
or production settings were accessed; no runtime source was changed.
The audit read repository source and migrations; it did not attest live schema,
live counts, current shared URLs, provider jobs or existing asset ownership.

This updates the public/assets/background findings in
`LEGACY_CATALOG_SURFACE_AUDIT.md`; the original private-API finding predates
implemented C1 containment. Current private containment is confirmed in
`routes/catalogs.js` and `services/legacyBusinessSurface.js`. It does **not** cover
the independent public viewer, upload handlers or registered actorless refresh job.

## Verified current behavior

| Surface / exact anchor | Current behavior | Remaining boundary |
| --- | --- | --- |
| `server.js`, `app.get('/catalog/:slug/:token'` | No auth; selects definition by global `id` plus `public_token`; loads current pages by global `catalog_id` with `is_active=true`. Definition `status`/`is_active`, organization and business are not checked. | Draft/inactive definition remains addressable if its token matches. A later active-page edit immediately changes the shared content; there is no publication revision selection. |
| `routes/catalogs.js`, `router.post('/:catalogId/public-link'` | Creates 16 random bytes encoded as hex, writes the single plaintext `public_token`, returns the URL. Existing value is replaced. The UPDATE result is not checked before success. | No separate revoke/expiry/publication event model; a missing catalog can receive a success-shaped URL response. Token rotation does not revoke underlying image URLs. |
| `db/migrations/135_catalog_enhancements.sql` | Adds nullable `public_token`, `status DEFAULT 'draft'`, cover URL and token index. | Neither field establishes owner or approved publication. Names, Park branding and token possession do not prove ownership. |
| `server.js`, `catalogImageBlobHandler` mounts | Public GET/HEAD `/uploads/catalog-images/items/:filename`, then local static fallback, then terminal 404. Generic `/uploads` static serving also exists. | Filename is a public address, independent of catalog token and membership. Public-image withdrawal must check all actual serving paths. |
| `services/imageStorage.js`, `storeCatalogImageBlob` / `readCatalogImageBlobByFilename` | Filename primary key, upsert of bytes/source URL/metadata; read by filename alone. `buildCatalogImageBlobFallbackHandler` returns `public, max-age=31536000, immutable`; DB absence/error falls through to local storage. | No entity/business FK or publication decision. Rewriting bytes at an immutable URL does not reliably invalidate existing caches; removing a blob can expose its legacy local copy. |
| `services/imageStorage.js`, `uploadFromUrl` | With a queryable, stores a blob; without it, writes local `items` file. Returns the same public URL format. Metadata is optional. | Storage backend or filename prefix is not an ownership proof. `catalog_image_blobs` also holds product/menu assets. |
| `services/menuPhotoGeneration.js`, `services/menuImageDrafts.js`, `services/programIconGeneration.js` | Reuse `imageStorage` for product/menu/program imagery. Menu drafts have explicit business checks in persistence; program icon flow has product-bound state in `routes/products.js`. | Do not authenticate/block/delete the whole shared image prefix to fix only legacy catalogs. These domains need their own source/reference classification, not an inferred catalog owner. |
| `routes/catalogs.js`, generation/poll/apply handlers | Private router first runs auth + `requireLegacyBusinessSurface('catalogs')`; retained pre-cutover Park also needs the existing role gates. KIE task IDs are returned, accepted for poll, and supplied with `itemId`/`catalogId` for apply; no durable catalog-job row is created in these handlers. | Membership callers are locally contained. The retained compatibility engine does not bind request, provider task, actor, tenant and destination. A role string or provider task ID is insufficient to reopen it for memberships. |
| `routes/catalogs.js`, `router.post('/apply-image'` / `router.post('/:catalogId/apply-cover'` | Polls provider, downloads/saves image, then updates item/definition. Missing item falls back to name `item`/catalog `misc`; cover also updates page zero in a separate query. Neither target UPDATE requires one affected row. | Missing/deactivated/reassigned targets and partial failure can leave stored assets or inconsistent cover/page URLs. Provider polling/download precedes full target proof. |
| `services/scheduler.js`, `checkStaleCatalogImages`; `server.js` registration; `config/schedulerSurface.js` | Registered on a 60-second interval with daily guard; function targets 03:00 Kyiv, global marker `stale_catalog_images`, up to 10 active items older than six days. Joins global definitions, creates KIE jobs, polls once after 20 seconds, writes returned temporary URL by item ID. No business argument or ownership check. | Ordinary startup registers this actorless writer outside the private catalog router. Backup recovery/outbound-hold skips background startup, but does not provide tenant ownership. Actual execution/credentials/scheduler state were not checked. |
| Same scheduler function | Stores daily marker before selecting/refreshing. Provider task ID only lives in that invocation; no durable retry/apply state, upload-to-blob or destination version predicate. | A crash/lost result cannot be safely resumed from an owned job; a delayed result can replace an operator's newer image. Daily dedup does not prove tenant isolation or exactly-once work. |
| `routes/catalogs.js`, `/publish`, `/items/:id/telegram`, `/:catalogId/automations/:id/run` | Publish can create global `price_rules`, then a task; Telegram accepts `targetChatId` or configured fallback; automation tasks carry source IDs and `owner_role`, without explicit business context. | These are price/task/provider side effects, not simple catalog edits. Private containment remains necessary; reopening them requires the relevant domain owner and a bound destination. |

`config/serviceWorkerPolicy.js` classifies uploads as private runtime paths for
network/cache policy. That name does not add authentication to the public Express
handlers. Browser/service-worker cache behavior and origin access policy are
separate boundaries.

## OWN-04 — Public catalog links — PENDING

**Recommendation:** private by default for newly classified catalogs; public access
only through an explicit publication authorized for the proven owner. Keep the
approved URL content independent of draft edits. Record publication revision,
publisher, time and revocation state; store token verification material separately
from ordinary catalog response fields. Recheck owner business/organization and
publication state at read time. A missing, revoked or unavailable publication returns
the same unavailable response without leaking why.

Owner choices needed before implementation:

1. **Existing links:** approve a specific allowlist to retain, or approve targeted
   retirement/reissue. Recommendation: retain only entries with approved ownership
   and publication, and prepare a separate transition for unclassified entries.
   No mapping or retirement is executed by this recommendation. A blanket revoke
   can break links already sent to customers; blanket retention preserves exposure.
2. **Content changes:** approved revision/snapshot versus always-current active
   pages. Recommendation: approved revision, because current edits otherwise change
   customer-facing descriptions/prices without a publish action. This changes no
   pricing formula; it defines which already-entered content is shown. If live
   updates are chosen, explicitly approve that behavior and its audit rule.
3. **Lifetime and deactivation:** choose expiry policy and whether organization,
   business or catalog deactivation immediately ends public serving. Recommendation:
   deactivation ends serving. No expiry is approved: `DECISIONS.md` proposes a
   configurable 30-day expiry for **new** links versus a business/campaign-specific
   lifetime, for review only. Existing links remain unchanged. Previously saved
   browser images/PDFs remain outside origin revocation.

Dependency: OWN-01/OWN-02/OWN-03 owner and shared-library mapping. Scope candidates:
public-link handler, exact public viewer handler, catalog publication schema/service
and their tests. The viewer currently hardcodes Park contacts/branding; future
publication must use approved business branding, without global theme/router redesign.

## OWN-05 — Shared image storage and public/private assets — PENDING

**Recommendation:** distinguish owner, referenced entity and publication status.
Maintain durable references from asset to catalog/product/page/job and its business;
use explicit organization sharing if OWN-02 approves it. New private drafts must
not become public merely because storage returned a filename. Keep intentionally
public product/menu images available, with immutable versioned asset identities.

Owner choices needed:

1. **Existing images:** which are approved public marketing/product/menu material,
   which are private drafts, and which are unknown? The aggregate token/blob count
   cannot answer this. Recommendation: use an approved per-asset/reference mapping;
   unknown/mixed references block that asset's migration, not all images.
2. **Shared references/copies:** may multiple business-owned records reuse the same
   approved image, or must they receive independent copies? Recommendation: explicit
   shared-library reference for approved material; otherwise independent identity.
   Deleting one reference must not remove another business's approved image.
3. **Withdrawal and retention:** choose origin revocation and retained draft/history
   duration, including local fallback and external URLs. Recommendation: stop serving
   withdrawn private content through every origin path and retain only the agreed
   audit/history objects. Existing downloads, provider/CDN copies and immutable
   browser caches cannot be promised deleted by a database update.

Implementation candidates after approval: asset reference schema, `imageStorage`
read/write/fallback policy, exact catalog-image mounts, catalog apply paths and
scoped product/menu consumers. Review `config/storageSurface.js` and cache policy
contracts; do not blanket change `/uploads`, auth, or hosting settings. Provider
temporary URLs should not silently become the permanent published fallback after
failed durable storage; choose an explicit failed/pending state instead.

## OWN-06 — Actorless refresh, provider jobs and operator actions — PENDING

**Recommendation:** a future generation operation owns a durable local request ID,
organization/business, initiator or approved job principal, destination type/ID,
expected destination revision, provider/task reference, status and retry key. Resolve
the owner from the stored request and destination on poll/apply/retry; never trust a
client-supplied task/destination pair. Revalidate active owner and module capability
before a fresh provider call or write. A revoked initiator's delayed job needs an
explicit continuation/cancellation policy; do not silently substitute the owner.

Owner choices needed:

1. **Current `checkStaleCatalogImages`:** keep only a reviewed ownership allowlist,
   or approve a targeted pause until classification. Recommendation: targeted pause
   while no such allowlist exists, then opt-in owned refresh. A pause stops automatic
   repair of expiring images; continuing the current global job leaves an actorless
   writer outside C1. **Neither option has been applied.** Do not touch other
   schedulers, provider credentials or Railway settings under this choice.
2. **Result application:** automatic replacement versus operator approval after
   generation. Recommendation: require review before replacing a published asset;
   unchanged owned private destinations may use an explicitly approved automatic
   path. In either case, a stale revision must not overwrite a later edit.
3. **Generation budget, retries and old jobs:** choose who authorizes spend and
   which bounded retries are allowed. Recommendation: idempotency per owned request,
   no retry after unknown provider acceptance until reconciled, and no adoption of
   an old task ID without its original owner/destination evidence. No budget or TTL
   is invented here; shared provider account settings stay unchanged.
4. **Task/Telegram/price side effects:** name the responsible business, allowed
   recipient and domain owner separately. Recommendation: explicit business-local
   task ownership, no unbound Telegram destination/default, and do not enable global
   price-rule creation for memberships until the pricing owner approves its mapping. This
   decision pack does not authorize messaging, price changes or integration rollout.

Minimal future execution: persist intent before provider dispatch; persist returned
provider ID; lock/revalidate request and destination before attaching results; commit
attachment/status atomically; stage/retain failed results under that request rather
than leaving unreferenced public blobs. Provider-side creation is not rolled back by
SQL: record an ambiguous/failed outcome for reconciliation instead of claiming
exactly-once provider delivery. Existing product `icon_job_id` state in
`routes/products.js` is a pattern to inspect, not proof that catalog jobs already
have tenant ownership or a reason to merge distinct product flows.

## Evidence needed and future executable checks

Restricted inventory needs existing catalog identity/publication state, proven owner,
referenced page/item/product, asset address/backend/content hash, reference count,
and provider request/task/destination evidence where available. Keep actual tokens,
provider URLs, filenames containing customer text and raw prompts out of public
reports. Aggregate output should expose counts/status/reason only. Unknown ownership
must remain unknown; a matching name, creator, filename or embedded catalog ID does
not establish it. `audit-multibusiness-ownership.js` reports token presence and table
counts but explicitly does not certify embedded JSON, external assets or jobs.

| Proposed test package | Required scenarios / zero-side-effect assertions |
| --- | --- |
| Public viewer HTTP + disposable PG | Proven publication works; wrong/rotated/revoked/expired token, draft revision, inactive owner and cross-catalog token fail; no foreign names/counts/assets. Missing catalog cannot mint a success URL. Draft edit does not change a snapshot; chosen live-update behavior is tested if approved instead. |
| Asset HTTP GET/HEAD + disposable storage | Own private read, foreign/no-session deny, approved public product/menu image works; DB/local fallback cannot bypass revocation; same filename/new version cache semantics; multiple references prevent destructive cleanup; metadata/source URL is not sent with image bytes. |
| Catalog provider-job HTTP/service/PG | Forged task ID/destination/type, foreign org/business and revoked membership deny **before** provider poll/download; missing parent/stale revision/failed UPDATE rolls back attachment; concurrent apply and retry are idempotent; provider-completed/local-failed case remains recoverable and owned. Use local provider stubs only. |
| Scheduled refresh | Invoke a synthetic 03:00 tick with owned, foreign, inactive and unmapped rows; zero calls for disallowed rows; business-specific retry/dedup; concurrent tick, provider timeout, late result and target edit cannot cross ownership or overwrite newer state. Test the exact approved pause/allowlist choice. |
| Operator side effects | Business-scoped task destination; forbidden Telegram/provider/price paths execute zero calls; explicit failures do not commit a partial catalog publication or report successful apply. No real messages/payments/generation. |

Existing starting points: `tests/image-storage.test.js`,
`tests/scheduler-static-jobs-behavior.test.js`,
`tests/integration/legacy-business-containment-postgres.test.js` and
`tests/telegram-startup-skip.test.js`. They are partial component/containment checks,
not acceptance of this proposed policy. No tests were executed in this read-only
documentation subtask. Public/jobs migration stays BLOCKED until OWN-04/05/06 are
approved and implemented with the actual source/consumer matrix above.
