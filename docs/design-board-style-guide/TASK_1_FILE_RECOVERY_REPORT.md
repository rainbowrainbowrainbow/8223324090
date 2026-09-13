# TASK 1 - Design Board file source and recovery preparation

Generated: 2026-09-13 Europe/Kyiv
Base: `codex/eventgenix-production` at `f06cfe5391b715ea6cbae567d4ced824726ada67`
Scope: read-only storage/source audit and recovery planning. No product code, database schema, auth, dependencies, production data, commit, push, or deploy changes were made.

## Executive status

Saved material recovery: `BLOCKED_BY_DATA`

Reason: the current database still has three Design Board metadata records, but no Postgres blob bytes, no legacy `uploads/designs` files in the checked source root, and no verified operator backup/source root.

Existing recovery tooling: `READY_WITH_SOURCE`

Reason: the repository already has a legacy upload backfill tool that supports the `designs` segment and writes to `design_file_blobs` with dry-run, manifest hash, checksum, idempotence, explicit apply confirmation, and per-record rollback behavior. It cannot recover bytes until an operator supplies the original files or a DB backup with blob bytes.

## Current source of truth

The active Design Board file model is:

- `designs`: metadata, including `filename`, `original_name`, `mime_type`, `file_size`, `storage_provider`, `storage_key`, and `storage_migrated_at`.
- `design_file_blobs`: Postgres-backed bytes for new or migrated uploads.
- `uploads/designs`: legacy filesystem fallback path for old file URLs and previews.

New uploads in `routes/designs.js` read the temporary Multer file, insert a `designs` metadata row, store the bytes through `storeDesignBlob()`, mark the row as Postgres-backed through `markDesignStored()`, and delete the temporary local upload after commit.

Downloads and Telegram sends call `readDesignBuffer()`, which tries `design_file_blobs` first and then checks `uploads/designs/<filename>`.

## Fresh read-only audit

Command:

```bash
node scripts/audit-design-material-storage.js --limit 500 --json
```

Result generated at `2026-09-13T08:08:18.163Z`:

```json
{
  "manifestHash": "6ee18d80c03ab89775a31652b562704f18bf93eda5bb5864b1fb7668d5cb282c",
  "summary": {
    "scanned": 3,
    "ok": 0,
    "recoverableFromLocal": 0,
    "keyMismatches": 0,
    "missingSources": 3,
    "invalidMetadata": 0,
    "byVerdict": {
      "SOURCE_MISSING": 3
    }
  },
  "piiIncluded": false,
  "binaryIncluded": false,
  "filenamesIncluded": false,
  "readOnly": true
}
```

## Material recovery map

| Opaque material id | MIME type | Metadata bytes | Blob bytes | Legacy local bytes | Status |
| --- | --- | ---: | ---: | ---: | --- |
| `cbb1961a26c5dd442f6b` | `image/jpeg` | 107661 | none | none | `SOURCE_MISSING` |
| `5583836badd708765d90` | `image/jpeg` | 110144 | none | none | `SOURCE_MISSING` |
| `0b0a0bd2d52ec636d333` | `image/jpeg` | 110144 | none | none | `SOURCE_MISSING` |

All three records have `storageProvider: null` and `hasStorageKey: false`. The audit intentionally includes only opaque ids and hashes; filenames, binary contents, and secrets are not printed.

## Existing recovery/import mechanism

The existing importer candidate is `scripts/backfill-legacy-upload-blobs.js`.

Relevant support already exists:

- `--segment designs` limits the run to Design Board files.
- `--source-root <root>` expects files under `<root>/uploads/designs`.
- dry-run is the default unless `--apply` is present.
- JSON manifests redact filenames and file contents.
- `manifestHash` plus `--expected-count` are required for apply.
- `--confirm=BACKFILL_LEGACY_UPLOAD_BLOBS` is required for apply.
- checksum and byte-length are verified before and after insert.
- apply uses a transaction per candidate plus advisory lock.
- failed writes return `APPLY_FAILED_ROLLED_BACK`.
- retry after a successful write becomes `EXISTING_EXACT_BLOB`.

One small tooling gap exists: the audit script accepts `PRODUCTION_READONLY_DATABASE_URL`, but the legacy backfill script currently accepts only `DATABASE_PUBLIC_URL`, `DATABASE_URL`, or `TEST_DATABASE_URL`. For a dry-run against a read-only production connection, either provide the same read-only URL as process-local `DATABASE_PUBLIC_URL`, or make a separate small tooling-only change later to let the backfill script accept `PRODUCTION_READONLY_DATABASE_URL` for dry-run.

## Backup/source requirement

Recovery needs one verified source:

1. Filesystem backup with the exact structure:

```text
<restored-root>/
  uploads/
    designs/
      <original stored filenames>
```

2. Database backup where `design_file_blobs.data` exists for these records.

3. External storage export with a durable mapping from each design record to original storage key/filename and bytes.

The two current `.codex-remote-attachments` JPEG files are not a verified source root. Their byte sizes, 99598 and 103510, do not match the current missing metadata sizes, 107661 and 110144.

## Next command after operator provides filesystem backup

First, verify the source without writing anything:

```bash
node scripts/audit-design-material-storage.js --limit 500 --source-root "<restored-root>" --json
```

Expected unblock signal:

```text
recoverableFromLocal: 3
SOURCE_MISSING: 0
LEGACY_DISK_SOURCE_PRESENT: 3
```

Then generate an importer dry-run manifest for Design Board only:

```bash
node scripts/backfill-legacy-upload-blobs.js --segment designs --source-root "<restored-root>" --json
```

Expected dry-run unblock signal:

```text
writeCandidates: 3
unrecoverableSourceMissing: 0
checksumConflicts: 0
blocked: 0
```

Apply must remain a separate explicitly authorized production-data operation after the dry-run manifest is reviewed. The apply command shape is:

```bash
node scripts/backfill-legacy-upload-blobs.js --segment designs --source-root "<restored-root>" --apply --confirm=BACKFILL_LEGACY_UPLOAD_BLOBS --expected-count=3 --manifest-hash="<dry-run-manifest-hash>" --json
```

## Done status for this task

Each current material has a factual status: all three are `SOURCE_MISSING`.

A verified recovery path exists only after an operator provides a matching backup/source root. Until then, recovery remains `BLOCKED_BY_DATA`; missing bytes cannot be reconstructed from metadata.

## Verification performed

- `git status --short --branch`: worktree is on `codex/design-board-storage-isolation-unblock`; existing `TASK_2_STORAGE_ISOLATION_REPORT.md` remains untracked and preserved.
- `git rev-parse HEAD`: `f06cfe5391b715ea6cbae567d4ced824726ada67`.
- `git rev-parse origin/codex/eventgenix-production`: `f06cfe5391b715ea6cbae567d4ced824726ada67`.
- `npm run check:runtime`: passed on Node `22.23.1` and npm `10.9.8`.
- `node scripts/audit-design-material-storage.js --limit 500 --json`: passed as read-only audit, `SOURCE_MISSING: 3`.
- `uploads/designs` inspection: only `.gitkeep` exists in the current worktree.
- `scripts/backfill-legacy-upload-blobs.js --segment designs --source-root . --json`: did not run because the script requires `DATABASE_PUBLIC_URL`, `DATABASE_URL`, or `TEST_DATABASE_URL`; the available audit connection is exposed through `PRODUCTION_READONLY_DATABASE_URL`.

## Rollback

This task added only this report. Rollback is deleting this document. No runtime behavior or data changed.
