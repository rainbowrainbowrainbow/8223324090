# D-02 containment security review

Date: 2026-09-12. Read-only review of the dirty `codex/sys-mb-auth-p0-20260912` worktree based on `a5180def01a1e47f8f4fc75e2f7a43092f205828`. Source changes from earlier checkpoints are intentional. This review changed only this ignored artifact; no production connection, provider call, schema or runtime edit was performed.

## Recommended bounded policy

Proposed future scope: protect the entire `/api/catalogs`, `/api/booking-templates`, `/api/recurring` routers and the single `GET /api/finance/report/salary` endpoint. These surfaces have global records or global calculations without a trustworthy business owner. **No runtime containment is implemented in this analysis increment.** The proposal has business impact: it would make these features unavailable for Park membership and narrow their current CRM/MD compatibility access.

1. Keep existing authentication, roles/actions, and the aggregate write guard. Resolve the actual request with `resolveBusinessScope(req)` and reject invalid scope before treating anything as legacy compatibility.
2. Permit the existing legacy path only when the resolved scope is **single**, its active context is **event_genix**, and server-resolved membership mode is **false**. This is preservation of the pre-cutover Park access path, not an ownership assignment for global records.
3. Deny active Park/Dar/custom membership, CRM/MD/Dar compatibility contexts, and valid aggregate reads with HTTP **403** and a stable surface-specific code. Suggested names: `catalogs_not_migrated`, `booking_templates_not_migrated`, `recurring_not_migrated`, `finance_salary_not_migrated`. Root may choose consistent final names before tests.
4. Denial must occur before any surface SQL, identifier lookup, room normalization, quote/generation function, payroll calculation, image storage, event publishing, or provider operation. Preserve current successful legacy payloads and financial calculations. Do not return an empty result with 200 for a blocked feature.

`membershipEnabled` alone is insufficient. `services/businessMembership.js:50` intentionally allows a compatible CRM context to retain global roles. A pure local reproduction with a global director, a lower-role Dar membership, and requested CRM returned `{membershipEnabled:false, role:"director", scopeInvalid:false, activeContext:"crm"}`. Since global SQL ignores that active CRM context, a guard checking only membership mode would expose global records. Requiring the valid legacy Park context closes this bypass without granting new access.

Do not allow by platform creator, organization owner, username, `created_by`, a selected product's business, or the presence of any organization membership. None establishes ownership of these global rows. An invalid/revoked membership may have `membershipEnabled:false`; checking scope invalidity first is therefore mandatory.

## Exact expected outcomes

| Request/principal | Expected outcome |
| --- | --- |
| No token or invalid token | Existing authentication **401**; containment must not create an anonymous Park fallback. |
| Revoked, inactive, foreign, malformed, or unavailable business | Existing scope **403**, retaining `business_context_unavailable` or the resolver's precise reason. SQL/provider counters remain zero. |
| Authorized single Park/Dar/custom membership | **403** surface `*_not_migrated`, including platform creators who also have an active operational membership. |
| Authorized CRM/MD/Dar compatibility context | **403** surface `*_not_migrated`; compatibility does not authorize global data. |
| Valid same-organization aggregate GET | **403** surface `*_not_migrated`. |
| Aggregate mutation | Preserve upstream **403** `business_scope_read_only`; invalid aggregate may fail earlier with organization/permissions/scope errors. |
| Valid single pre-cutover Park compatibility | Continue to the original endpoint and its original RBAC/validation. Existing unauthorized finance roles/actions still receive **403**; authorized legacy results keep their current shape. |
| Membership/schema lookup fails | Preserve auth's fail-closed error; never turn database failure into legacy access. |

Header/query/body context paths need coverage. `services/businessContext.js:325` now explicitly copies `body`, `query`, `headers`, and `user` because spreading an Express request loses inherited headers. Existing regressions are `tests/finance-business-isolation.test.js:85` and the actual-HTTP CRM scenario in `tests/integration/finance-business-isolation-postgres.test.js`.

## Source inventory and business decisions

| Surface | Evidence | Boundary / outstanding decision |
| --- | --- | --- |
| General catalog engine | `routes/catalogs.js:70`, `:127`, `:153`, `:189` query/mutate global definitions/items; page routes start at `:751`; generation begins at `:245`; public-token creation is `:873`; automation execution is `:934`. Migrations 093/127/135/136 do not declare business ownership for these catalog rows. | Entire private router containment avoids alternative-path leaks. Decide durable ownership versus intentional publication/sharing before re-enabling membership. Products/graduation scoped tables and Dar products in migration347 are different data models. |
| Booking templates | `routes/booking-templates.js:42` lists globally; `:55` creates; `:99` updates by ID; `:158` increments usage; `:176` deletes. Migration075 has no business owner. Room normalization uses `DEFAULT_TIMELINE_CONTEXT` at `:69` and `:119`. | Block all methods before room normalization or SQL. Do not derive template ownership from an optional product or creator username. Existing routes use authentication without a separate mutation role; preserve, do not widen or silently redesign that legacy contract. |
| Recurring booking templates | `routes/recurring.js:51` authenticates; list `:127`, create `:182`, generation `:578`/`:611`, series/delete/skips `:632`/`:662`/`:736`/`:754`/`:820` are global or ID based. Migration003 has no owner for templates/skips. `services/recurring.js:274` generates into `DEFAULT_TIMELINE_CONTEXT`. | Block the whole HTTP router, including skip removal and generate-all. Do not infer ownership from a subset of already-created occurrences. Mixed-business occurrences are a preflight conflict requiring an explicit migration decision. |
| Task templates | Migration238 explicitly adds `task_templates.business_context`. | These are not the unowned booking/recurring templates. Do not apply the new blanket gate by a generic "templates" name. |
| Finance salary | `routes/finance.js:730` calls `getSalaryReport(month)` without scope. `services/payroll.js:3954` builds the report with empty period options; staff selection at `:1157`/`:1170` is global. | Contain this finance endpoint only. Do not filter payroll amounts by guessed staff-to-business ownership or change canonical payroll service/payment endpoints in the same patch. |
| Finance staff/certificate references | Startup declares global `staff` at `db/index.js:246` and `certificates` at `:329`; no corresponding business owner column was found in migrations. D-01 guards are `routes/finance.js:173` and retained-reference validation near `:492`. | Existing membership POST/PUT reference quarantine remains. `certificates.customer_id`, `employee_profiles.user_id`, issued-by or staff usernames are not an ownership policy. A CRM compatibility transaction still preserves legacy global references by D-01 design; this is explicitly not a completed tenant migration. |

## Residuals containment does not solve

- **Public catalog links:** `server.js:627` serves `/catalog/:slug/:token` by a stored token, outside `/api/catalogs`. The proposed private-API gate does not revoke existing published links. Preflight may count rows with tokens but must never emit token values or URLs. Publication/revocation policy is separate.
- **Recurring generator callers:** Eager/manual calls in `routes/recurring.js:293`, `:593` and the generate-all route are proven. `services/scheduler.js:780` defines and `:2495` exports `checkRecurringBookings`, but server imports/registration and `config/schedulerSurface.js` do not register it. It is dormant in the inspected runtime; the generic "recurring" scheduler label refers to other task/afisha jobs. Do not claim recurring-booking background generation is active. The service still reads global active templates at `services/recurring.js:564` when explicitly called.
- **Registered catalog background job:** `checkStaleCatalogImages` at `services/scheduler.js:2098` is imported and registered by `server.js:33`/`:857` and owned in `config/schedulerSurface.js:37`. Its actorless storage/database work is outside the private API gate and requires a separate ownership/consumer review. Do not generalize an HTTP containment result to this background job.
- **Finance notifications:** `routes/finance.js:436` publishes `finance.income` without business identity. `services/eventBus.js:104` selects global rules; `:294`/`:313` choose/write an actual chat channel. Migration098 defines a channel-3 finance rule. Current WS membership protection cannot undo a message already placed in an unrelated shared channel. This remains `not_migrated` and is not fixed by a salary gate.
- **Certificate and staff APIs:** Their whole lifecycle/HR integration is outside this bounded patch. `routes/certificates.js:58` lists global certificates and imports Telegram functions at `:17`. Containing finance references is not proof that these APIs are tenant isolated.
- **UI behavior:** Park membership catalog/template/recurring/salary entrypoints may now receive explicit 403. This is intended temporary unavailability. Do not label the whole product flow ready until the user-visible unavailable state and later ownership migration are reviewed.

## Read-only preflight safety

Do not copy the connection/safety behavior of `scripts/audit-multibusiness-readiness.js`. It imports `../db` at line5 (the normal `DATABASE_URL` pool), runs separate autocommit queries, prints usernames/roles, and only checks table existence before assuming `business_context` exists. Its SQL is currently read-only, but this is not an enforced read-only connection/transaction and a missing column aborts the inventory.

Use the stronger pattern from `scripts/audit-payroll-activation-preflight.js:78` and `:504`, with the following bounds:

- Dedicated explicit `MULTIBUSINESS_AUDIT_DATABASE_URL` or equivalent documented read-only audit variable; **no `DATABASE_URL` fallback**. Construct a `pg.Pool` directly, without importing server startup or operational services. Never print the connection string or raw connection errors.
- One client, `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY`, assert `SHOW transaction_read_only` is `on`, bounded statement/lock/idle transaction timeouts, and guaranteed rollback/release/pool cleanup. Sequential reads on that single client provide a consistent snapshot.
- Probe both tables and columns before querying. Use static allowlisted identifiers; parameterize all values. Missing/unknown schema is `not_checked` or `not_migrated`, not zero rows, PASS, or assumed Park ownership.
- Emit aggregated counts and statuses: table ownership capability, blank/unknown context counts, cross-reference conflicts, recurring occurrence-context distributions, active global automation counts, public-link counts. Do not emit usernames, names, contacts, descriptions, payroll rates/amounts, token values, credentials, or provider configuration. A table having only Park references is an observation, not authorization to assign an owner.
- Report that `releaseAllowed`/migration readiness remains false while ownership decisions are unresolved; do not equate a successfully completed read-only query with green tenant cutover. No bootstrap, backfill, generated records, owner assignment, writes, publish, exports, or notifications.
- Make module imports inert (`require.main === module`), with injectable query functions for unit fixtures. Test missing audit connection, refusal of non-read-only transaction, timeout/error cleanup, missing schema, mixed owners, and no sensitive output. Actual local PG can assert a write receives PostgreSQL `25006` and verify all owned fixture counts are unchanged.

## Minimum verification for the implementation

1. Behavioral router tests, using SQL/provider/generation/payroll spies that fail if containment is crossed: all method classes, direct IDs, alternate generation/history/public-token paths, query/header/body context, invalid access, membership Park/Dar/custom, CRM/MD compatibility, aggregate reads/writes.
2. Positive legacy Park tests keep original status/body and role/action denials; successful scoped finance transactions and ordinary booking CRUD are outside these router gates and remain reachable with their existing authorization.
3. Actual HTTP/PostgreSQL tests use the existing guarded fixture pattern in `tests/integration/finance-business-isolation-postgres.test.js`: loopback only, dedicated test opt-in, no production environment or DATABASE_URL fallback, UUID-named disposable database, real current auth/membership, same-token revocation, explicit cleanup assertions. No provider generation or real payroll calculation is necessary to prove a gate runs first.
4. Report static/source tests, actual-PG tests, and live QA separately. This audit itself is not live QA or rollout approval.

## Independent review of the new preflight

Reviewed `scripts/audit-multibusiness-ownership.js`, SHA256 `6846156fe32efce90fb8ea929cfb427872a75771069e5152300a8dc488a7ca76`, including the added room-reference, linked-child, activity-flag, public-token and RLS checks. No blocking read-only, identifier-injection, output-redaction, or missing-schema defect remains in the inspected version.

- The script uses the dedicated URL only, imports no application DB/startup path, permits no apply mode, verifies a read-only repeatable-read transaction, uses fixed identifiers and bounded queries, and rolls back/releases on success or failure. CLI failures use a fixed allowlist of codes rather than driver messages or connection data. Output contains counts, fixed table/relationship labels, and explicit limitations.
- Initial `publishedRows` based on `status='published'` was inaccurate: catalogs use draft/ready and the public viewer relies on the token regardless of status. This was corrected to `catalog_public_tokens`, requiring only `public_token` and counting its presence without emitting values.
- RLS visibility was explicitly resolved: metadata records `pg_class.relrowsecurity`; enabled tables and every dependent observation return `NOT_CHECKED_ROW_SECURITY` with unknown counts. Both missing-schema and RLS reasons remain in `collectionIssues`, and collection is incomplete. This conservative policy applies even to a connection that might bypass RLS; the script does not infer privilege or change database roles/settings permanently.
- Successful collection always retains `HOLD_OWNERSHIP_DECISIONS`, `ownershipEstablished:false`, and `safeToAutoBackfill:false`. It cannot authorize cutover or assign global records to Park.
- This independent review read the implementation and unit fixture coverage; execution of unit/PostgreSQL suites is owned by root and the integration agent. No live database or runtime containment test was performed by this review.
