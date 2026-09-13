# D-02 — Booking templates and recurring ownership audit

Captured: 2026-09-12 14:25:51 UTC. Worktree: `codex/sys-mb-auth-p0-20260912`, base `a5180def01a1e47f8f4fc75e2f7a43092f205828`. Read-only source review. No production access, operational SQL execution, runtime edit, scheduler invocation, or unrelated test run.

## Conclusion

Both reusable booking templates and recurring templates are currently global records without business/organization ownership. An active business membership cannot prove the right to read or mutate a particular template. A filter on `created_by`, product context, or room name would invent ownership. Recommended immediate state: `not_migrated`, with a complete containment decision covering both direct membership requests and access through legacy MD/CRM contexts. An active-membership-only API guard is insufficient because the same global data remains reachable by selecting a permitted compatibility context.

The recurring engine always creates Park bookings. The exported daily scheduler helper describes 00:07 Kyiv execution, but **no current server registration/import or scheduler manifest entry for `checkRecurringBookings` was found**. Manual generation and eager generation on template creation are reachable now. Do not describe automatic nightly execution as a verified active deployment fact.

## Durable schema and ambiguous relationships

| Surface | Actual evidence | Ownership implication |
|---|---|---|
| `booking_templates` | Migration `075_booking_templates.sql:2`: serial `id`, `product_id`, copied product fields, room, notes, `created_by`, favorites/usage. Migration `296_room_resource_id_schema.sql:11` adds `room_resource_id`. | No `business_context`, `organization_id`, `business_id`, or durable account owner. `created_by` is text, not an ownership FK. Product ID is also not an FK. |
| `recurring_templates` | Migration `003_recurring_bookings.sql:5`: serial `id`, recurrence/date/time, product snapshot, `line_id` integer, names for preferred/second animator, notes/extra data, `is_active`, `created_by`. Migration 176 adds pinata fields; migration 296 adds room resource ID. | Same missing owner/context. Staff names and legacy line IDs do not prove tenant ownership. |
| `recurring_booking_skips` | Migration `003_recurring_bookings.sql:58`: `template_id` FK to recurring templates, `ON DELETE CASCADE`; unique `(template_id,date)`; details/reason/notified. | Can inherit ownership only after its parent gains a proven owner. Current details may include private booking/animator descriptions. |
| `bookings.recurring_template_id` | Migration `003_recurring_bookings.sql:73` adds integer + index; no FK there. Migration `004_data_integrity.sql:8` adds unique `(recurring_template_id,date)` for non-cancelled instances. | Parent can be missing; instances can carry different business contexts. Do not infer series owner from the first instance. Existing unique-index semantics are not a business-isolation guarantee. |
| `bookings.linked_to` | Recurring cancellation follows this link by ID, without a business predicate. | A poisoned link can pull another business's child into a cancellation set. Booking identity/link mapping changes remain protected and outside containment. |
| Products/resources | Template `product_id` points at globally keyed `products.id`; room IDs are unique only with `timeline_resources.business_context`. | A product context is a candidate signal only. A shared textual room resource ID may validly resolve in multiple businesses. |

Migration 296 comments at lines 76–80 explicitly say both template tables do not carry `business_context`. `scripts/backfill-room-resource-id.js:31-32` likewise lists them with `context:false`; that operator script uses a default Park context and must not be repurposed as an ownership migration. A repository search found no later template/skip owner-column migration or DB-startup owner backfill.

## All direct HTTP surfaces

Actual mounts: `server.js:284` `/api/booking-templates`; `server.js:298` `/api/recurring`. Central `apiAuthBoundary` at `server.js:256` authenticates sessions, and `businessScopeWriteGuard` at `:267` already denies aggregate writes. Neither supplies per-record ownership. Single-business requests proceed to these routers; router bodies have no current business/capability checks beyond authentication. Aggregate GET remains a disclosure path until contained.

| Endpoint | Code | Current risk |
|---|---|---|
| GET `/api/booking-templates` | `routes/booking-templates.js:42-46` | Lists all global snapshots, notes, prices, creator names. |
| POST `/api/booking-templates` | `:55-91` | Inserts global data; supplied room identity is validated against hardcoded Park at `:68`. |
| PUT `/api/booking-templates/:id` | `:99-150` | Reads/updates only by ID; same hardcoded Park validation at `:118`. |
| POST `/api/booking-templates/:id/use` | `:158-171` | Global usage mutation returns the full template by ID. Must not be exempted as harmless telemetry. |
| DELETE `/api/booking-templates/:id` | `:176-184` | Deletes any ID; no ownership test. |
| GET `/api/recurring` | `routes/recurring.js:127-174` | All template snapshots + cross-business instance and skip counts. |
| POST `/api/recurring` | `:182-312` | Global insert, hardcoded Park room validation (`:217`), eager generation (`:293`). |
| PUT `/api/recurring/:id` | `:325-465` | Global ID read/update, Park room validation (`:372`), global history entry. |
| DELETE `/api/recurring/:id?deleteFuture=true` | `:475-538` | Deactivates global template; cancels future bookings by template ID without context. Transaction/banquet cancellation guards protect consistency, not tenant ownership. |
| POST `/api/recurring/:id/pause` | `:547-573` | Toggles global template active state. |
| POST `/api/recurring/:id/generate` | `:578-606` | Calls generator on any template ID. |
| POST `/api/recurring/generate-all` | `:611-625` | Calls generator for every active global template. |
| GET `/api/recurring/:id/series` | `:632-655` | `SELECT * FROM bookings` by template ID, then canonical `mapBookingRow`; no business or `getVisibleBookingScope` filter. Private linked operational data is returned. |
| DELETE `/api/recurring/:id/series/future` | `:662-728` | Cross-context template root selection and unscoped `linked_to` child expansion (`:683-686`) before cancellation. |
| GET `/api/recurring/:id/skips` | `:736-749` | Global skip details by template ID. |
| POST `/api/recurring/:id/skips` | `:754-814` | Records manual skip and cancels instance IDs without context. |
| DELETE `/api/recurring/skips/:skipId` | `:820-833` | Deletes skip by ID, enabling generation retry for a global template. |

Containment must run before pool connections, canonical room/default-resource helpers, generation, history, cancellation, or usage mutation. Unknown IDs should receive the same containment result as existing IDs; do not leak existence first. Router-level placement must cover every nested route and Express HEAD handling. Auth and existing aggregate denial may return first; either way, no domain query/mutation should occur.

## Generator and background paths

- `services/recurring.js:274-278`: generator validates ticket safety then canonicalizes room identity in `DEFAULT_TIMELINE_CONTEXT` (Park), before iterating dates. It accepts a template row and has no actor/membership input.
- `:298-310`: instance dedup checks Park; skip lookup is global by template/date.
- `:168-220`: preferred-line lookup, fallback, and default-line creation always target Park. Name resolution is not durable business staff ownership.
- `:352-370`: shared `staff`/`staff_schedule` name lookup; missing-table/errors are swallowed. HR ownership is outside this patch.
- `:430-448`, `:470-488`: primary and linked bookings are inserted into Park. History at `:494-501` also targets Park.
- `:506-522`: after commit, `processBookingAutomation` is invoked asynchronously with Park booking data; side effects depend on configured automation. No QA/preflight should invoke the generator.
- `:546-608`: `generateAllRecurringBookings` reads global setting `recurring_booking_horizon`, loads every active template, and executes each one. Manual `/generate-all` and eager-create are proven callers.
- `services/scheduler.js:780-795`: exported `checkRecurringBookings` would execute daily at 00:07 Kyiv and stores `recurring_bookings` marker before calling generation. `server.js:33` does not import it; interval registration at `:801-802` covers recurring tasks and afisha, not recurring bookings. `config/schedulerSurface.js` has no entry for this helper. This is a dormant code path in this checkout, not proof that every external operator/deployment cannot call it.
- Template room-resource backfill script and full-backup recovery are operator surfaces separate from HTTP containment. Do not execute either as preflight.

## Frontend consumers and containment UX implications

- `js/booking-form.js:257-266` loads templates through `getAuthHeaders`, which now includes current business headers (`js/api.js:1945`). The backend currently ignores those for template ownership.
- `js/booking-form.js:280-328` fills room/product/customer-input fields from a cached global template, then calls `/:id/use`. Failure of the usage call does not undo local field application.
- `_templates` is an IIFE cache (`:251`); a failed next-context load simply returns, without clearing previous templates (`:262`). Thus an API guard alone does not clear already-loaded template options after a business switch. Proposed UX containment must clear cached templates and disable/hide template controls with a visible not-migrated explanation, without rewriting protected booking identity/renderers.
- Save at `:369-387` only reports success on `res.ok`; rejected HTTP responses are currently silent. A future guard needs an explicit safe disabled/error state.
- `js/booking.js:18526-18563` posts recurring form data with a token directly. Payload includes copied booking fields but no `businessContext` and no source booking ID. Server inference therefore follows session default, not proven source-booking ownership. Body/header additions alone cannot fix the absent template owner.
- No non-test JavaScript consumer of recurring series/skips/pause/generate-all was found; those direct APIs remain accessible even when absent from navigation.

## Complete containment proposal (not implemented)

1. Until ownership is assigned, classify both modules as `not_migrated`; preserve schema, generation/collision formulas and protected booking mapping.
2. Deny every listed operational API for membership contexts with stable codes such as `booking_templates_not_migrated` / `recurring_not_migrated`. Do not grant an exception to organization owner, director or platform creator merely because of role.
3. **Resolve compatibility bypass before claiming completion.** A membership account can select permitted MD/CRM compatibility and reach the same global rows; legacy-only accounts can reach them too. With no record owner, there is no safe per-business allowlist. The simplest complete containment is a temporary global freeze of these global APIs after cutover, including legacy requests; this changes compatibility availability and needs an explicit owner/release decision. If legacy APIs remain available, record containment as partial/blocked and do not claim zero cross-business access.
4. Clear cached frontend template choices on context change, block applying stale cached records, show a clear unavailable state. Preserve canonical booking forms, source priorities and renderers.
5. Keep exported generation helpers and operator jobs marked `not_migrated`; route denial blocks proven current HTTP invocation. Do not silently re-enable/register the dormant scheduled helper. Future service/operator containment and owner-scoped generation must be delivered in an explicit scheduler/domain block after a complete execution inventory.
6. Only after ownership policy and count preflight: idempotent owner migration, context-aware parent/child/skip queries, scoped product/room/staff references, explicit migration of existing records, then controlled service/scheduler enablement. Existing product/room clues must never assign owner automatically.

## Read-only preflight SQL draft

Run only through an explicitly selected read-only connection and a read-only transaction with timeout. First inspect relation/column presence; if a prerequisite is missing, return `NOT_TESTABLE`/`blocked` metadata and skip its query. Do not catch schema errors and emit reassuring zero counts. No raw names, notes, template IDs or account names in the report. These queries were source-reviewed, not executed against production.

```sql
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '10s';

SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('booking_templates', 'recurring_templates',
    'recurring_booking_skips', 'bookings', 'products', 'timeline_resources')
  AND column_name IN ('id', 'business_context', 'business_id', 'organization_id',
    'created_by', 'product_id', 'room_resource_id', 'resource_id',
    'recurring_template_id', 'template_id', 'linked_to', 'is_active');

SELECT
  (SELECT COUNT(*) FROM booking_templates) AS booking_templates_total,
  (SELECT COUNT(*) FROM recurring_templates) AS recurring_templates_total,
  (SELECT COUNT(*) FROM recurring_templates WHERE is_active IS TRUE) AS recurring_templates_active,
  (SELECT COUNT(*) FROM recurring_booking_skips) AS skips_total,
  (SELECT COUNT(*) FROM bookings WHERE recurring_template_id IS NOT NULL) AS instances_total;

SELECT COUNT(*) AS orphan_instances
FROM bookings b LEFT JOIN recurring_templates t ON t.id = b.recurring_template_id
WHERE b.recurring_template_id IS NOT NULL AND t.id IS NULL;

SELECT COUNT(*) AS orphan_skips
FROM recurring_booking_skips s LEFT JOIN recurring_templates t ON t.id = s.template_id
WHERE t.id IS NULL;

WITH series AS (
  SELECT recurring_template_id,
    COUNT(DISTINCT NULLIF(BTRIM(business_context), '')) AS known_contexts,
    COUNT(*) FILTER (WHERE NULLIF(BTRIM(business_context), '') IS NULL) AS missing_contexts
  FROM bookings WHERE recurring_template_id IS NOT NULL
  GROUP BY recurring_template_id
)
SELECT COUNT(*) FILTER (WHERE known_contexts > 1) AS mixed_business_series,
  COUNT(*) FILTER (WHERE missing_contexts > 0) AS series_with_unknown_context,
  COUNT(*) FILTER (WHERE known_contexts = 1 AND missing_contexts = 0) AS single_context_candidates
FROM series;

SELECT COUNT(*) AS uninstantiated_templates
FROM recurring_templates t
WHERE NOT EXISTS (SELECT 1 FROM bookings b WHERE b.recurring_template_id = t.id);

SELECT COUNT(*) AS cross_context_links_in_recurring_sets
FROM bookings child JOIN bookings parent ON parent.id = child.linked_to
WHERE (child.recurring_template_id IS NOT NULL OR parent.recurring_template_id IS NOT NULL)
  AND NULLIF(BTRIM(child.business_context), '')
    IS DISTINCT FROM NULLIF(BTRIM(parent.business_context), '');

WITH templates AS (
  SELECT 'booking'::text AS kind, id, product_id, room_resource_id FROM booking_templates
  UNION ALL
  SELECT 'recurring', id, product_id, room_resource_id FROM recurring_templates
)
SELECT t.kind, COUNT(*) AS total,
  COUNT(*) FILTER (WHERE NULLIF(BTRIM(t.product_id), '') IS NULL) AS no_product,
  COUNT(*) FILTER (WHERE NULLIF(BTRIM(t.product_id), '') IS NOT NULL AND p.id IS NULL) AS orphan_product,
  COUNT(*) FILTER (WHERE p.id IS NOT NULL AND NULLIF(BTRIM(p.business_context), '') IS NULL) AS product_context_unknown
FROM templates t LEFT JOIN products p ON p.id = t.product_id
GROUP BY t.kind;

WITH templates AS (
  SELECT 'booking'::text AS kind, id, room_resource_id FROM booking_templates
  UNION ALL SELECT 'recurring', id, room_resource_id FROM recurring_templates
), candidates AS (
  SELECT t.kind, t.id, t.room_resource_id,
    COUNT(DISTINCT NULLIF(BTRIM(r.business_context), '')) AS context_candidates,
    COUNT(r.id) AS matching_resources
  FROM templates t LEFT JOIN timeline_resources r ON r.resource_id = t.room_resource_id
  GROUP BY t.kind, t.id, t.room_resource_id
)
SELECT kind,
  COUNT(*) FILTER (WHERE NULLIF(BTRIM(room_resource_id), '') IS NULL) AS no_room_identity,
  COUNT(*) FILTER (WHERE NULLIF(BTRIM(room_resource_id), '') IS NOT NULL AND matching_resources = 0) AS orphan_room_identity,
  COUNT(*) FILTER (WHERE context_candidates > 1) AS ambiguous_room_businesses
FROM candidates GROUP BY kind;

ROLLBACK;
```

Additional useful counts for the runner: instance context not registered in `businesses`; distinct product-context versus known instance-context conflicts per series; missing linked parents; child template ID different from parent template ID; active recurring templates with zero instances; current schema constraints on recurring-template references. Unknown NULL/blank context must stay separate from Park. PostgreSQL totals are `int8`: do not silently truncate large counts.

## Executable expectations for the next patch

**Read-only preflight integration:** disposable PostgreSQL fixtures containing zero tables/partial schema/complete empty schema, missing template parents, mixed Park/Dar instances, unknown/blank contexts, uninstantiated templates, orphan product IDs, shared room IDs across two businesses, poisoned linked children, and valid skip FK. Assert exact counts plus transaction read-only state and no before/after row changes. Verify aggregate output contains no synthetic private names/notes/IDs. Absent schema must be an explicit missing prerequisite. Run twice and prove identical output except capture time.

**Future containment HTTP tests:** actual authentication + route mount + disposable PostgreSQL, using active Park/Dar memberships, same old JWT after role/default change, organization owner/creator, foreign membership, and MD/CRM compatibility switches. Exercise all 17 method/path combinations listed above (plus HEAD/unknown IDs/query/body/header context spellings); assert no domain query, connect, helper, generation, history, automation, or mutation on denied requests. Existing aggregate 403 and ordinary unauthenticated 401 remain valid earlier denials. Include exact legacy-scope bypass reproduction so the chosen policy cannot accidentally claim complete containment.

**Future UI tests:** load a template in a permitted legacy fixture, switch to blocked membership context, ensure cached options are removed and template application cannot fill fields or send `/use`; save explains unavailable state; recurring creation cannot send an unscoped request from a blocked context. No protected mapper/renderer change is needed for a disabled control.

**Future scheduler scope:** source-level registration check documents helper remains dormant; any newly enabled job requires owned template context and side-effect tests before being registered. Do not use a global-generation integration test in production.

Existing tests cover recurring query batching (`tests/query-batching.test.js:166`), room identity (`tests/room-resource-backfill.test.js` / `tests/timeline-resources.test.js`), and global history context contracts (`tests/operational-business-context.test.js:348`). Those are not tenant-ownership acceptance. No tests were run as part of this audit.
