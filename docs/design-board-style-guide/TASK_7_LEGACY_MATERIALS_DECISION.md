# TASK 7 — Design Board legacy materials decision

Generated: 2026-09-13T10:54:14Z
Production URL: https://8223324090-production.up.railway.app
Mode: read-only audit only
Deployed SHA audited: 79e03e0517da3f8d46e9ea12ae433e568f9cb799

## Summary

Production currently has 7 Design Board metadata records.

- Total designs: 7
- Metadata only: 3
- Blob exists: 4
- Filesystem source exists under checked source root: 0
- Source missing: 3
- Ownership NULL: 3
- Ownership non-NULL: 4
- Collections total: 1
- Collections ownership NULL: 0
- Collections ownership non-NULL: 1

Canonical storage audit command:

```bash
node scripts/audit-design-material-storage.js --limit 500 --json
```

Audit manifest hash: `c6d453682658c1bdc6205f58c8f91ab8618e5c82cb066436be8cf101261303de`

The audit script checked local source format as:

```text
SOURCE_ROOT/uploads/designs/<filename>
```

No `DESIGN_RECOVERY_SOURCE_ROOT` / `DESIGN_AUDIT_SOURCE_ROOT` was provided during this audit, so recovery was checked only against the repo source root shape.

## Legacy records requiring operator decision

These rows are hidden from scoped Design Board API because `business_context IS NULL`. They must remain hidden until an operator approves exact ownership mapping.

| design_id | state | title | original_name | filename | mime_type | metadata_bytes | collection_id | business_context | created_by | created_by_user_id | blob_count | local_source_exists |
|---:|---|---|---|---|---|---:|---|---|---|---|---:|---|
| 8 | SOURCE_MISSING | photo_2026-03-15 15.15.19 | photo_2026-03-15 15.15.19.jpeg | 7ae4d1f48c056882e4b5864dbba9f2ae.jpeg | image/jpeg | 107661 | NULL | NULL | Natalia | NULL | 0 | false |
| 9 | SOURCE_MISSING | photo_2026-04-02 18.01.06 | photo_2026-04-02 18.01.06.jpeg | 8dd2ddbe5b03a8a8be0308da57ce289b.jpeg | image/jpeg | 110144 | NULL | NULL | Natalia | NULL | 0 | false |
| 10 | SOURCE_MISSING | photo_2026-04-02 18.01.06 | photo_2026-04-02 18.01.06.jpeg | 663440023abb8193e03a9bdca279ab5e.jpeg | image/jpeg | 110144 | NULL | NULL | Natalia | NULL | 0 | false |

## Existing non-legacy records

These are TASK 6 demo/test records and already have ownership and blobs.

| design_id | state | business_context | created_by | created_by_user_id | collection_id | mime_type | blob_bytes | checksum_sha256 |
|---:|---|---|---|---:|---|---|---:|---|
| 11 | blob_exists | dar | Sergey | 4 | 1 | image/svg+xml | 835 | eed060114bc93ac3f65d6380f88466f1b896d1de999af1d571a76377641228e6 |
| 12 | blob_exists | dar | Sergey | 4 | 1 | application/pdf | 625 | f680f6651d9c5e816b989805194c65891b54c01fe14974146b03d2107244b624 |
| 13 | blob_exists | event_genix | Sergey | 4 | NULL | image/svg+xml | 907 | 874f6c0ddb930b879c39b3bfd22f49dac37d543cfaf332a296e1c39818f54195 |
| 14 | blob_exists | event_genix | Sergey | 4 | NULL | application/pdf | 654 | f51cdc8da0b8c853aed989fcc1cccde62b820b9898ab3c89c1ffdc9a25201dad |

## Collections

| collection_id | name | business_context | created_by_user_id | design_count |
|---:|---|---|---:|---:|
| 1 | CODEx Demo QA 202609130930 Collection | dar | 4 | 2 |

No legacy collection ownership backfill is needed because there are no NULL-owned collections.

## File recovery decision

Status: `BLOCKED_BY_DATA`.

The old files cannot be recovered from metadata. There is no blob in `design_file_blobs`, no `storage_key`, no `storage_provider`, and no filesystem source found in the checked source root.

To unblock recovery, provide a backup/source root with this exact layout:

```text
<backup-root>/uploads/designs/7ae4d1f48c056882e4b5864dbba9f2ae.jpeg
<backup-root>/uploads/designs/8dd2ddbe5b03a8a8be0308da57ce289b.jpeg
<backup-root>/uploads/designs/663440023abb8193e03a9bdca279ab5e.jpeg
```

Expected sizes:

- `7ae4d1f48c056882e4b5864dbba9f2ae.jpeg` → 107661 bytes
- `8dd2ddbe5b03a8a8be0308da57ce289b.jpeg` → 110144 bytes
- `663440023abb8193e03a9bdca279ab5e.jpeg` → 110144 bytes

After a source root is provided, run a dry-run recovery map only:

```powershell
$env:DESIGN_RECOVERY_SOURCE_ROOT = '<absolute-backup-root>'
node scripts/audit-design-material-storage.js --limit 500 --source-root $env:DESIGN_RECOVERY_SOURCE_ROOT --json
```

Do not import until the audit shows `LEGACY_DISK_SOURCE_PRESENT` for the intended rows and the operator approves exact checksums.

## Ownership mapping candidate

Status: `NEEDS_OPERATOR_MAPPING`.

The only factual owner hint on legacy rows is `created_by = Natalia`. Production has `users.id = 3`, `username = Natalia`, but that user is authorized for multiple business contexts:

```text
event_genix, dar, maysternya_doli, crm
```

Therefore this audit cannot safely infer `business_context`. Do not assign these rows to `event_genix` or any default company automatically.

Candidate requiring explicit operator approval:

| design_id | proposed_business_context | proposed_created_by_user_id | confidence | reason |
|---:|---|---:|---|---|
| 8 | OPERATOR_REQUIRED | 3 | partial | `created_by` matches user `Natalia`, but business context is ambiguous |
| 9 | OPERATOR_REQUIRED | 3 | partial | `created_by` matches user `Natalia`, but business context is ambiguous |
| 10 | OPERATOR_REQUIRED | 3 | partial | `created_by` matches user `Natalia`, but business context is ambiguous |

If the operator confirms the company/context, the minimum approved mapping artifact should be:

```json
{
  "designs": [
    { "design_id": 8, "business_context": "<approved_context>", "created_by_user_id": 3 },
    { "design_id": 9, "business_context": "<approved_context>", "created_by_user_id": 3 },
    { "design_id": 10, "business_context": "<approved_context>", "created_by_user_id": 3 }
  ],
  "collections": []
}
```

Allowed contexts must come from the current product context model, for example one of:

```text
event_genix, dar, maysternya_doli, crm
```

## Apply status

No production ownership backfill was applied.
No production file import was applied.
No legacy metadata was deleted or edited.
No fake replacement files were generated.

## Rollback plan for future approved apply

Ownership backfill rollback must update only the exact approved rows back to their previous values:

- `designs.business_context`: previous value `NULL`
- `designs.created_by_user_id`: previous value `NULL`

File import rollback must remove only exact imported `design_file_blobs` rows by verified `design_id`, `storage_key`, and `checksum_sha256`. Do not delete metadata rows.

