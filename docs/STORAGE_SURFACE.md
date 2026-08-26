# Event Genix Storage Surface Map

This document records the intended upload storage surface for Event Genix. The
machine-readable source is `config/storageSurface.js`; `npm run
check:storage-surface` verifies that local `/uploads` paths, Postgres metadata,
tests, docs, and ignore rules stay aligned.

## Why This Exists

Railway app filesystems should be treated as ephemeral unless a persistent
volume is explicitly configured. A local upload path can look fine in a manual
test and still disappear across redeploys, restarts, or new instances.

The rule going forward is simple: any new local upload path or remote storage
provider must be listed here and in `config/storageSurface.js`. If it changes
product behavior, add focused route or service tests in the same pack.

## Static Upload Mount

| Public Path | Local Root | Owner | Notes |
| --- | --- | --- | --- |
| `/uploads` | `uploads` | server | Public static mount from `server.js` for documented legacy and fallback upload files. |

## Local Upload Paths

| Public Prefix | Local Directory | Owner | Persistence | Tests | Notes |
| --- | --- | --- | --- | --- | --- |
| `/uploads/chat` | `uploads/chat` | chat | `local-postgres-metadata` | `tests/chat-upload-storage.test.js`, `tests/chat-upload-route.test.js` | New chat attachments store binary content in Postgres `chat_upload_blobs`; `/uploads/chat` stays as the public URL and legacy local fallback. |
| `/uploads/sounds` | `uploads/sounds` | sound | `local-postgres-metadata` | `tests/audio-storage.test.js` | New manual and generated sound uploads store binary content in Postgres `sound_upload_blobs`; `/uploads/sounds` stays as the public URL and legacy local fallback. |
| `/uploads/profile-avatars` | `uploads/profile-avatars` | profile | `local-postgres-metadata` | `tests/profile-avatar-storage.test.js`, `tests/route-smoke.test.js` | New profile avatar uploads store binary content in Postgres `profile_avatar_blobs`; `/uploads/profile-avatars` stays as the public URL and legacy local fallback. |
| `/uploads/catalog-images` | `uploads/catalog-images` | catalogs | `local-postgres-metadata` | `tests/image-storage.test.js` | New generated catalog images store binary content in Postgres `catalog_image_blobs`; `/uploads/catalog-images` stays as the public URL and legacy local fallback. |
| `/uploads/designs` | `uploads/designs` | designs | `local-postgres-metadata` | `tests/designs.test.js`, `tests/design-storage.test.js` | New design board assets are stored in Postgres `design_file_blobs`; the public path remains for previews and legacy disk fallback. |

All local upload directories must stay ignored in `.gitignore`, including
`uploads/chat`, `uploads/sounds`, `uploads/profile-avatars`,
`uploads/catalog-images`, and `uploads/designs`.

## Local Fallback Policy

Every local upload path has an explicit fallback policy in
`config/storageSurface.js`:

- `postgres-blob-primary-local-legacy`: new writes store binary content in
  Postgres and local files remain a legacy read fallback only. Current paths:
  `/uploads/chat` (`chat_upload_blobs`), `/uploads/sounds`
  (`sound_upload_blobs`), `/uploads/profile-avatars`
  (`profile_avatar_blobs`), `/uploads/catalog-images` (`catalog_image_blobs`),
  and `/uploads/designs` (`design_file_blobs`).

All local fallback policies set `reviewBeforeDelete: true`. Do not delete an
`uploads/*` directory or route until the related rows have been migrated,
exported, or explicitly confirmed obsolete.

## Remote Storage Buckets

There are currently no active remote storage buckets in the CRM runtime. Legacy
rows may still contain external URLs from older deployments; new writes should
use the local upload surface plus Postgres metadata or Postgres-backed binary
storage unless a new storage provider is explicitly introduced and documented
here.

## Current Risk

`/uploads/designs` is no longer new-write local-only storage. New uploads write
binary content to `design_file_blobs`, while old local files remain readable as
a fallback. Do not delete `uploads/designs` during cleanup until old design rows
have been migrated or confirmed obsolete.

Sound uploads are now different: new manual and generated writes store binary
content in `sound_upload_blobs`, and `/uploads/sounds/*` first checks Postgres
before falling back to legacy local files. Existing old local sound URLs remain
compatible, but missing sound upload URLs return 404 and must not fall through to
CRM HTML.

Chat uploads are now different: new writes store binary content in
`chat_upload_blobs`, and `/uploads/chat/*` first checks Postgres before falling
back to legacy local files. Existing old local chat upload URLs remain
compatible, but missing upload URLs return 404 and must not fall through to CRM
HTML.

Catalog image uploads are now different: new Hermes/product menu image writes
store binary content in `catalog_image_blobs`, and
`/uploads/catalog-images/items/*` first checks Postgres before falling back to
legacy local files. Missing catalog image upload URLs must return 404 and must
not fall through to CRM HTML.

Profile avatar uploads are now different: new writes store binary content in
`profile_avatar_blobs`, and `/uploads/profile-avatars/*` first checks Postgres
before falling back to local disk for legacy files. Existing old local avatar
URLs remain compatible, but missing legacy files are not backfilled.

## Legacy Upload Backfill

Task 23 adds a checksum-based operator backfill for existing local upload
fallback files. The script is intentionally not part of normal runtime startup.

Operator command:

```bash
npm run backfill:legacy-uploads -- --segment chat --json
```

Supported segments:

- `chat` -> `chat_upload_blobs`
- `sounds` -> `sound_upload_blobs`
- `profile-avatars` -> `profile_avatar_blobs`
- `catalog-images` -> `catalog_image_blobs`
- `designs` -> `design_file_blobs`

The script is dry-run by default and emits only redacted metadata: counts,
opaque source IDs, storage-key SHA256, byte length, checksums, and verdicts. It
must not print filenames, customer text, chat content, binary bytes, secrets, or
raw upload URLs.

Apply mode requires all three operator gates:

```bash
npm run backfill:legacy-uploads:apply -- \
  --segment chat \
  --expected-count <dry-run writeCandidates> \
  --manifest-hash <dry-run manifestHash> \
  --confirm=BACKFILL_LEGACY_UPLOAD_BLOBS
```

Backfill rules:

- exact existing Postgres blob -> skip;
- missing legacy source bytes -> `UNRECOVERABLE_SOURCE_MISSING`;
- different existing checksum -> `CHECKSUM_CONFLICT` and no overwrite;
- metadata/blob failure -> transaction rollback for that record;
- local fallback files remain in place;
- metadata rows and public URLs are not changed by the backfill.

Run apply one segment at a time, then rerun dry-run for that same segment. A
completed segment should show zero `WRITE_CANDIDATE` rows. If old Railway local
filesystem bytes are already gone, the script cannot reconstruct them; keep the
redacted missing-source manifest for backup search or manual recovery.

## What This Gives

- Clarifies which uploaded files are expected to survive redeploys.
- Makes hidden local disk growth visible before cleanup or deployment.
- Prevents new `/uploads/<segment>` paths from appearing without ownership,
  docs, ignore rules, and focused tests.
- Keeps `/uploads/designs` visible as a legacy public preview/fallback path.

## Done Marker

This pack is considered done when all of these remain true:

- `npm run check:storage-surface` passes.
- `npm test` includes `npm run check:storage-surface`.
- New local upload paths update `config/storageSurface.js`,
  `docs/STORAGE_SURFACE.md`, `.gitignore`, and focused tests in the same
  commit.
- New remote storage providers update `config/storageSurface.js`,
  `docs/STORAGE_SURFACE.md`, and focused service tests in the same commit.
