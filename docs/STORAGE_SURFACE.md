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
| `/uploads/chat` | `uploads/chat` | chat | `local-postgres-metadata` | `tests/chat-upload-storage.test.js`, `tests/chat-upload-route.test.js` | Chat attachments are stored under `/uploads/chat`; message metadata lives in Postgres. |
| `/uploads/sounds` | `uploads/sounds` | sound | `local-postgres-metadata` | `tests/audio-storage.test.js` | Manual and generated sound uploads are stored under `/uploads/sounds`; `sounds.storage_*` metadata lives in Postgres. |
| `/uploads/profile-avatars` | `uploads/profile-avatars` | profile | `local-postgres-metadata` | `tests/profile-avatar-storage.test.js`, `tests/route-smoke.test.js` | New profile avatar uploads store binary content in Postgres `profile_avatar_blobs`; `/uploads/profile-avatars` stays as the public URL and legacy local fallback. |
| `/uploads/catalog-images` | `uploads/catalog-images` | catalogs | `local-postgres-metadata` | `tests/image-storage.test.js` | Generated catalog images are stored under `/uploads/catalog-images`; catalog item URLs live in Postgres-backed catalogs. |
| `/uploads/designs` | `uploads/designs` | designs | `local-postgres-metadata` | `tests/designs.test.js`, `tests/design-storage.test.js` | New design board assets are stored in Postgres `design_file_blobs`; the public path remains for previews and legacy disk fallback. |

All local upload directories must stay ignored in `.gitignore`, including
`uploads/chat`, `uploads/sounds`, `uploads/profile-avatars`,
`uploads/catalog-images`, and `uploads/designs`.

## Local Fallback Policy

Every local upload path has an explicit fallback policy in
`config/storageSurface.js`:

- `local-filesystem-primary`: the local file is still the primary binary source;
  Postgres keeps metadata only. Current paths: `/uploads/chat`
  (`chat_messages metadata`), `/uploads/sounds` (`sounds metadata`), and
  `/uploads/catalog-images` (`catalog item URL metadata`).
- `postgres-blob-primary-local-legacy`: new writes store binary content in
  Postgres and local files remain a legacy read fallback only. Current paths:
  `/uploads/profile-avatars` (`profile_avatar_blobs`) and `/uploads/designs`
  (`design_file_blobs`).

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

Chat, sound, and catalog image uploads still follow the local upload + Postgres
metadata pattern. They should not be treated as durable across Railway
redeploys unless the runtime has a persistent volume or the next phase moves
binary content into a Postgres-backed file table.

Profile avatar uploads are now different: new writes store binary content in
`profile_avatar_blobs`, and `/uploads/profile-avatars/*` first checks Postgres
before falling back to local disk for legacy files. Existing old local avatar
URLs remain compatible, but missing legacy files are not backfilled.

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
