# Event Genix Storage Surface Map

This document records the intended upload and Supabase Storage surface for Event
Genix. The machine-readable source is `config/storageSurface.js`; `npm run
check:storage-surface` verifies that local `/uploads` paths, Supabase buckets,
tests, docs, and ignore rules stay aligned.

## Why This Exists

Railway app filesystems should be treated as ephemeral unless a persistent
volume is explicitly configured. A local upload path can look fine in a manual
test and still disappear across redeploys, restarts, or new instances.

The rule going forward is simple: any new local upload path, fallback path, or
Supabase Storage bucket must be listed here and in `config/storageSurface.js`.
If it changes product behavior, add focused route or service tests in the same
pack.

## Static Upload Mount

| Public Path | Local Root | Owner | Notes |
| --- | --- | --- | --- |
| `/uploads` | `uploads` | server | Public static mount from `server.js` for documented legacy and fallback upload files. |

## Local Upload Paths

| Public Prefix | Local Directory | Owner | Persistence | Tests | Notes |
| --- | --- | --- | --- | --- | --- |
| `/uploads/chat` | `uploads/chat` | chat | `supabase-preferred-local-fallback` | `tests/chat-upload-storage.test.js`, `tests/chat-upload-route.test.js` | New chat attachments prefer Supabase bucket `chat-uploads` through `SUPABASE_CHAT_BUCKET`; local files are only a fallback. |
| `/uploads/sounds` | `uploads/sounds` | sound | `supabase-preferred-local-fallback` | `tests/audio-storage.test.js` | Manual and generated sound uploads prefer Supabase bucket `audio-library` through `SUPABASE_AUDIO_BUCKET`; local files are only a fallback. |
| `/uploads/profile-avatars` | `uploads/profile-avatars` | profile | `supabase-preferred-local-fallback` | `tests/profile-avatar-storage.test.js` | User profile photos uploaded from desktop or mobile prefer Supabase bucket `profile-avatars` through `SUPABASE_PROFILE_AVATAR_BUCKET`; local files are only a fallback. |
| `/uploads/designs` | `uploads/designs` | designs | `local-only-legacy` | `tests/designs.test.js` | Design board assets still use local disk through `routes/designs.js` and are the main storage migration candidate. |

All local upload directories must stay ignored in `.gitignore`, including
`uploads/chat`, `uploads/sounds`, `uploads/profile-avatars`, and
`uploads/designs`.

## Supabase Storage Buckets

| Bucket | Env Override | Owner | Service | Routes | Local Fallback |
| --- | --- | --- | --- | --- | --- |
| `chat-uploads` | `SUPABASE_CHAT_BUCKET` | chat | `services/chatUploadStorage.js` | `routes/chat.js` | `/uploads/chat` |
| `audio-library` | `SUPABASE_AUDIO_BUCKET` | sound | `services/audioStorage.js` | `routes/music.js` | `/uploads/sounds` |
| `profile-avatars` | `SUPABASE_PROFILE_AVATAR_BUCKET` | profile | `services/profileAvatarStorage.js` | `routes/auth.js` | `/uploads/profile-avatars` |
| `catalog-images` | none | catalogs | `services/imageStorage.js` | `routes/catalogs.js` | none |

Shared Supabase client configuration lives in `db/supabase.js` and reads
`SUPABASE_URL`, `SUPABASE_KEY`, and `SUPABASE_SECRET_KEY`.

## Current Risk

`/uploads/designs` is intentionally documented as `local-only-legacy`. Those
files are not durable across Railway redeploys unless the runtime has a
persistent volume. Do not delete this path during cleanup without a migration
plan for existing design files and database rows.

The chat and sound local paths are safer than designs because they are fallback
paths. They still should not be treated as durable storage; the durable path is
Supabase Storage plus provider, bucket, key, and URL metadata.

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
- New Supabase Storage buckets update `config/storageSurface.js`,
  `docs/STORAGE_SURFACE.md`, and focused service tests in the same commit.
