# TASK 2 — Design Board saved materials and isolation unblock report

Generated: 2026-09-13 Europe/Kyiv
Base: `codex/eventgenix-production` at `f06cfe5391b715ea6cbae567d4ced824726ada67`
Scope: read-only audit plus implementation feasibility review. No database schema, migration, auth, production-data, dependency, billing, quota, folder-system, or frontend-substitute changes were made.

## Current source of truth

The current Design Board file model is split across three sources:

- `designs` stores material metadata: `id`, `filename`, `original_name`, `mime_type`, `file_size`, dimensions, title/description, pin flag, `collection_id`, `publish_date`, `created_by`, `created_at`, `storage_provider`, `storage_key`, and `storage_migrated_at`.
- `design_file_blobs` stores Postgres bytes for new or migrated uploads: `design_id`, `storage_key`, `data`, `checksum_sha256`, timestamps.
- `uploads/designs` remains the legacy filesystem fallback path for old files and compatible public preview URLs.

The active API implementation is in `routes/designs.js`. New uploads already write a metadata row, store the bytes in `design_file_blobs`, mark the metadata row as `storage_provider = 'postgres'`, and delete the temporary disk upload after commit. Downloads and Telegram send first try `design_file_blobs`, then fall back to `uploads/designs/<filename>`.

The storage helper is `services/designStorage.js`. The Postgres storage migration is `db/migrations/246_design_postgres_storage.sql`.

## Fresh read-only storage audit

Command:

```bash
node scripts/audit-design-material-storage.js --limit 500
```

Result:

```text
Design material storage audit
readOnly: true
manifestHash: 6ee18d80c03ab89775a31652b562704f18bf93eda5bb5864b1fb7668d5cb282c
scanned: 3
ok: 0
recoverableFromLocal: 0
keyMismatches: 0
missingSources: 3
invalidMetadata: 0
SOURCE_MISSING: 3
```

Safe recovery map command:

```bash
node scripts/audit-design-material-storage.js --limit 500 --json
```

Safe manifest facts:

- `piiIncluded: false`
- `binaryIncluded: false`
- `filenamesIncluded: false`
- scanned records: 3
- readable blobs: 0
- recoverable local files: 0
- key mismatches: 0
- missing source records: 3
- MIME types: 3 image/jpeg records
- metadata byte sizes: 107661, 110144, 110144
- all three records have no `storage_provider` and no `storage_key`

The audit intentionally reports only opaque ids and hashes. It does not print filenames, file contents, secrets, or production customer data.

## Live schema facts

Read-only `information_schema` check confirmed these Design Board columns in the currently reachable database:

### `designs`

- `id`
- `filename`
- `original_name`
- `mime_type`
- `file_size`
- `width`
- `height`
- `title`
- `description`
- `is_pinned`
- `collection_id`
- `publish_date`
- `created_by`
- `created_at`
- `storage_provider`
- `storage_key`
- `storage_migrated_at`

### `design_file_blobs`

- `id`
- `design_id`
- `storage_key`
- `data`
- `checksum_sha256`
- `created_at`
- `updated_at`

### `design_collections`

- `id`
- `name`
- `color`
- `sort_order`
- `created_at`

### `design_tags`

- `design_id`
- `tag`

Missing for durable isolation:

- no `business_context` on `designs`
- no `business_context` on `design_collections`
- no `business_context` on `design_tags`
- no `business_context` on `design_file_blobs`
- no `owner_user_id`, `account_id`, or equivalent stable owner column on `designs`
- no stable owner column on `design_collections`
- no FK from `designs.created_by` to `users.id`; `created_by` is a nullable text username snapshot only

## Current API isolation state

`routes/designs.js` currently applies:

- `authenticateToken`
- `requireRole('manager', 'art_director', 'marketer')`

It does not apply a company/account predicate to Design Board reads or writes.

Affected endpoints:

- `GET /api/designs`
- `GET /api/designs/tags`
- `GET /api/designs/calendar`
- `GET /api/designs/collections`
- `POST /api/designs/collections`
- `PUT /api/designs/collections/:id`
- `DELETE /api/designs/collections/:id`
- `POST /api/designs/upload`
- `GET /api/designs/:id/download`
- `PUT /api/designs/:id`
- `DELETE /api/designs/:id`
- `POST /api/designs/:id/telegram`

Because collections and tags are global in the schema, filtering only `designs.created_by` would still leave collection/tag leakage and would break shared board behavior for existing managers. It also would not provide company isolation, because `created_by` is nullable username text and does not encode a durable business/company context.

## Implementation feasibility without migrations

### Saved material access

Status: `BLOCKED_BY_DATA`

Reason: the metadata rows exist, but no bytes exist in `design_file_blobs`, no matching legacy files exist under the checked `uploads/designs` source root, and no `storage_key` points to a remote or local source. The backend cannot reconstruct binary files from metadata without an operator-supplied source.

Safe implementation possible now:

- Keep the current honest 404/download unavailable behavior.
- Keep the current UI unavailable state from TASK 1.
- Keep audit script as the recovery map generator.

Unsafe or rejected implementation:

- Do not fake preview URLs.
- Do not mark files as available when bytes are missing.
- Do not generate replacement image files from metadata.
- Do not hide missing records in frontend as a substitute for storage recovery.

### Company/account isolation

Status: `BLOCKED_BY_SCHEMA`

Reason: the current schema lacks the durable columns needed to scope design rows, collections, tags, and blob lookups by business/company/account. The only user-related column is nullable `created_by` text. That can support display attribution, but not a reliable authorization boundary.

Safe implementation possible now:

- No safe full isolation implementation without schema/API ownership changes.
- Existing role gate can remain as-is until a schema-backed predicate exists.

Unsafe or rejected implementation:

- Do not use frontend filtering as an isolation boundary.
- Do not rely on `created_by = req.user.username` for company isolation.
- Do not filter collections/tags globally while pretending designs are isolated.
- Do not infer company ownership from the current viewer's default business context without persisted row ownership.

## Minimal DB/API plan to unblock properly

This plan requires explicit DB schema/migration authorization before implementation.

### Migration plan

Add durable ownership columns:

1. `designs`
   - `business_context VARCHAR(64)` or equivalent project-wide company scope column
   - `created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL`
   - optional `updated_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL`
2. `design_collections`
   - `business_context VARCHAR(64) NOT NULL DEFAULT 'event_genix'`
   - optional `created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL`
3. `design_file_blobs`
   - either add `business_context VARCHAR(64)` for direct scoped blob queries, or enforce scope through a mandatory join to `designs`
4. `design_tags`
   - keep as child of `designs`; scope through `designs` joins, or add `business_context` only if global tag aggregation must be business-scoped without joining

Backfill rules need operator confirmation because current rows have no reliable source ownership:

- default existing three metadata rows to a single explicitly approved business context, most likely `event_genix`, only if the operator confirms they belong there;
- set `created_by_user_id` only when `created_by` exactly matches one active user and that assignment is approved;
- leave ambiguous/unknown owner rows with `created_by_user_id = NULL` and business context set only from operator-approved classification;
- do not invent owners from filenames, titles, or file sizes.

Indexes:

- `idx_designs_business_context_created_at` on `(business_context, created_at DESC)`
- `idx_designs_business_context_collection` on `(business_context, collection_id)`
- `idx_design_collections_business_context_sort` on `(business_context, sort_order, name)`
- optional unique collection name/index per business context if product wants it later; not required for MVP

### API predicate plan

Add a small helper in `routes/designs.js` or a dedicated service, following existing business-context patterns from modules like bookings/products:

- derive requested context from query/body only if the user is allowed to access it;
- otherwise use `req.user.default_business_context` or the canonical current business context helper if available;
- all read queries include `COALESCE(d.business_context, 'event_genix') = $context` only after migration/backfill is complete;
- all collection queries include `COALESCE(dc.business_context, 'event_genix') = $context`;
- tag aggregation always joins through scoped `designs`;
- download/update/delete/telegram first select the design with the same business context predicate, then proceed;
- upload inserts `business_context` and `created_by_user_id` together with existing metadata;
- collection create/update/delete are scoped by `business_context`.

Expected tests after schema approval:

- account/company A lists only A's designs;
- account/company A cannot download B's design;
- account/company A cannot update/delete/send B's design;
- tags endpoint returns tags only from scoped designs;
- collections endpoint returns collections only from scoped business context;
- upload stamps the selected business context and current user id;
- role restrictions still deny users outside `manager`, `art_director`, `marketer`;
- missing bytes still return honest 404/unavailable state.

## Recovery/import plan for missing bytes

Status: `BLOCKED_UNTIL_OPERATOR_SOURCE`

The operator must provide one of these sources:

1. a filesystem backup containing `uploads/designs/<filename>` from the original deployment;
2. a database backup where `design_file_blobs.data` exists for the three opaque records;
3. a verified external storage export that maps each material to the original filename/storage key and bytes.

Minimal safe importer after source is provided:

1. Run `node scripts/audit-design-material-storage.js --limit 500 --source-root <restored-root> --json`.
2. Confirm `LEGACY_DISK_SOURCE_PRESENT` for the affected rows and matching metadata byte sizes.
3. Add or run an operator-only import script in dry-run mode that:
   - reads files only from `<source-root>/uploads/designs`;
   - recomputes `designStorageKey(design.id, design.filename)`;
   - stores bytes into `design_file_blobs`;
   - updates `designs.storage_provider`, `designs.storage_key`, `designs.storage_migrated_at`;
   - does not alter titles, tags, collections, owners, or business context.
4. Apply only after explicit approval and backup confirmation.
5. Re-run the audit; expected result is `ok: 3`, `missingSources: 0` for those records.

## Minimal safe implementation decision for TASK 2

No product logic was changed because both requested unblock areas require protected inputs:

- saved bytes require operator-provided backup/source or a DB backup containing blob data;
- full isolation requires schema/API migration work and an approved backfill policy.

The current TASK 1 UI behavior is the correct MVP behavior until those blockers are removed: show saved metadata, expose preview/download only when bytes exist, and show a clean unavailable state for missing files.

## Rollback plan

This report-only change can be reverted by deleting this document. No runtime code, database schema, migrations, auth, data, secrets, dependencies, or production settings were changed.

For future implementation:

- if an API predicate change blocks legitimate Design Board access, revert only that predicate commit;
- if a migration/backfill is approved later, rollback must follow the migration's explicit `ROLLBACK` header and preserve any imported blob bytes until an operator confirms they can be discarded;
- never delete or mutate production material records as part of rollback without explicit production-data approval.
