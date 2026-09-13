# TASK 2 — Design Board company/account isolation implementation report

Generated: 2026-09-13 Europe/Kyiv
Base: `codex/eventgenix-production` at `f06cfe5391b715ea6cbae567d4ced824726ada67`
Branch/worktree: `codex/design-board-storage-isolation-unblock`

## Scope actually implemented

This task implemented server-side Design Board business-context isolation with a minimal additive migration and scoped API predicates. It also removed Design Board UI dependence on unauthenticated `/uploads/designs/*` file URLs so the scoped backend does not break previews. It did not change production data, run production migrations, modify global auth/session/role behavior, change billing, or add dependencies.

Authorized context source:

- `middleware/auth.js` hydrates the authenticated user with `businessContexts`, `defaultBusinessContext`, and membership-derived access.
- `services/businessContext.js` resolves the request scope through `resolveBusinessScope(req)`.
- Design Board endpoints require a single active business context via `requireBusinessScope(...)`; write endpoints also require `requireWritableBusinessScope(...)`.
- Client-supplied context is accepted only through the existing server-side business-context resolver and membership checks. Arbitrary IDs from the client are not trusted.

## Schema change

Added migration:

- `db/migrations/362_design_board_business_context.sql`

The migration adds nullable fields:

- `designs.business_context`
- `designs.created_by_user_id`
- `design_collections.business_context`
- `design_collections.created_by_user_id`

It also adds scoped indexes for normal board reads:

- `idx_designs_business_context_created_at`
- `idx_designs_business_context_collection`
- `idx_design_collections_business_context_sort`

The migration intentionally does not backfill legacy rows. Old records without a confirmed owner remain `NULL` and are not returned by the scoped API until an operator-approved mapping assigns a business context.

## API isolation

Updated file:

- `routes/designs.js`

Scoped routes:

- `GET /api/designs`
- `GET /api/designs/tags`
- `GET /api/designs/calendar`
- `GET /api/designs/collections`
- `POST /api/designs/collections`
- `PUT /api/designs/collections/:id`
- `DELETE /api/designs/collections/:id`
- `POST /api/designs/upload`
- `GET /api/designs/:id/download`
- `GET /api/designs/:id`
- `PUT /api/designs/:id`
- `DELETE /api/designs/:id`
- `POST /api/designs/:id/telegram`

Behavior:

- A user without membership in a requested business context receives `403`.
- A user with a valid active context who asks for another company's material receives `404`.
- Legacy rows with `business_context IS NULL` are hidden from scoped API results.
- Uploads stamp `business_context` and `created_by_user_id` from the authenticated server context.
- Upload/update rejects a `collection_id` from another business context.
- Tags are scoped by joining through `designs`.
- Blob reads/downloads are scoped by first loading the owning design row inside the active context.

## Direct upload URL handling

Updated files:

- `server.js`
- `services/designStorage.js`
- `js/designs-page.js`
- `designs.html`

The previous `/uploads/designs/:filename` blob fallback was unauthenticated and could not be made company-safe because a direct static URL does not carry an authorized business context. The server now disables public Design Board blob fallback and returns `404` for direct `GET`/`HEAD` under `/uploads/designs`.

The authenticated API download path remains the supported path for material bytes. Design Board lightbox, copy, download, and thumbnails now fetch bytes through the authenticated API path. Card thumbnails hydrate into local `blob:` URLs after an authorized fetch instead of using direct upload URLs.

Inline image-picker code in `designs.html` no longer writes `/uploads/designs/*` URLs. If an external image-generation provider must read a freshly uploaded Design Board reference file, that remains blocked until the product has an explicit signed/public-safe asset flow for that use case.

## Tests

Added/updated:

- `tests/design-board-isolation.test.js`
- `tests/design-storage.test.js`
- `tests/designs-page-ui.test.js`
- `tests/route-smoke.test.js`

Coverage:

- business A lists only A materials, collections, and tags;
- explicit unauthorized context returns `403`;
- foreign material detail/download/update/delete/Telegram returns `404`;
- foreign collection assignment is rejected on upload/update;
- valid uploads stamp the server-resolved business context;
- public direct Design Board blob fallback can be disabled;
- Design Board card markup does not point at `/uploads/designs/*`;
- route-smoke knows the new scoped tags query.

## Legacy data and operator mapping

Status: `BLOCKED_PENDING_OPERATOR_MAPPING`

The migration leaves existing rows unassigned. Before applying this to production and before backfilling, an operator must provide or approve a mapping:

```text
design_id -> business_context
collection_id -> business_context
optional created_by username -> user_id
```

Minimum safe backfill plan:

1. Run the storage audit and schema inspection read-only.
2. Export an opaque mapping candidate with ids, current nullable owner fields, storage status, file size, MIME type, and checksums when bytes exist.
3. Operator approves exact row-to-business assignments.
4. Apply a data-only backfill migration or one-off operator script in a transaction.
5. Re-run scoped API tests against a disposable PostgreSQL database before production apply.

Do not assign all legacy records to a default company without explicit operator approval.

## Verification performed

Passed:

- `npm run check:runtime`
- `npm run check:migrations`
- `node --test --experimental-test-isolation=none tests/design-board-isolation.test.js`
- `node --test --experimental-test-isolation=none tests/design-storage.test.js tests/design-material-storage-audit.test.js`
- `npm run check:auth-boundary`
- `npm run check:api-surface`
- `npm run check:storage-surface`
- `npm run check:static-surface`
- `npm run check:css-surface`
- `npm run check:syntax` outside the local sandbox after the sandboxed run failed with `spawnSync ... EPERM`
- `node --test --experimental-test-isolation=none tests/route-smoke.test.js`
- `npm run test:unit` outside the local sandbox after the sandboxed run failed with `spawn EPERM`

Not performed:

- Disposable PostgreSQL migration apply. No `TEST_DATABASE_URL`, `TEST_DB_URL`, or safe disposable DB URL was present in the environment. Production DB was not used.
- Live-site mutation QA. The task allowed read-only live inspection only and forbade production data changes.

## Rollback

Code rollback:

- Revert the scoped `routes/designs.js` changes if authorized same-context Design Board access fails.
- Revert the `server.js` and `services/designStorage.js` direct upload URL closure only if the product explicitly accepts unauthenticated direct Design Board file URLs again.

Database rollback after future apply:

- Drop the scoped indexes and nullable columns added by `362_design_board_business_context.sql` only after preserving or remapping any non-null ownership data.
- Do not roll back to cross-company-open API behavior.
