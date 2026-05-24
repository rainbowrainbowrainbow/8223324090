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
| `/uploads/profile-avatars` | `uploads/profile-avatars` | profile | `local-postgres-metadata` | `tests/profile-avatar-storage.test.js` | User profile photos are stored under `/uploads/profile-avatars`; `user_profiles_ext.avatar_url` lives in Postgres. |
| `/uploads/catalog-images` | `uploads/catalog-images` | catalogs | `local-postgres-metadata` | `tests/image-storage.test.js` | Generated catalog images are stored under `/uploads/catalog-images`; catalog item URLs live in Postgres-backed catalogs. |
| `/uploads/designs` | `uploads/designs` | designs | `local-only-legacy` | `tests/designs.test.js` | Design board assets still use local disk through `routes/designs.js` and are the main storage migration candidate. |

All local upload directories must stay ignored in `.gitignore`, including
`uploads/chat`, `uploads/sounds`, `uploads/profile-avatars`,
`uploads/catalog-images`, and `uploads/designs`.

## Remote Storage Buckets

There are currently no active remote storage buckets in the CRM runtime. Legacy
rows may still contain external URLs from older deployments; new writes should
use the local upload surface plus Postgres metadata unless a new storage
provider is explicitly introduced and documented here.

## Current Risk

`/uploads/designs` is intentionally documented as `local-only-legacy`. Those
files are not durable across Railway redeploys unless the runtime has a
persistent volume. Do not delete this path during cleanup without a migration
plan for existing design files and database rows.

Chat, sound, profile avatar, and catalog image uploads now follow the same
local upload + Postgres metadata pattern. They still should not be treated as
durable across Railway redeploys unless the runtime has a persistent volume or
the next phase moves binary content into a Postgres-backed file table.

## What This Gives

- Clarifies which uploaded files are expected to survive redeploys.
- Makes hidden local disk growth visible before cleanup or deployment.
- Prevents new `/uploads/<segment>` paths from appearing without ownership,
  docs, ignore rules, and focused tests.
- Identifies `/uploads/designs` as the next high-value storage migration pack.

## Done Marker

This pack is considered done when all of these remain true:

- `npm run check:storage-surface` passes.
- `npm test` includes `npm run check:storage-surface`.
- New local upload paths update `config/storageSurface.js`,
  `docs/STORAGE_SURFACE.md`, `.gitignore`, and focused tests in the same
  commit.
- New remote storage providers update `config/storageSurface.js`,
  `docs/STORAGE_SURFACE.md`, and focused service tests in the same commit.
