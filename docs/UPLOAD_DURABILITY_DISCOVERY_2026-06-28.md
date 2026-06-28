# Upload Durability Discovery

Date: 2026-06-28
Status: discovery report, no storage changes
Production impact: none from this document
Task: `SYSTEM_OPTIMIZATION_DETAILED_TASKS_2026-06-28.md` Task 04

## Summary

Event Genix has one public upload mount:

- `/uploads` -> local `uploads/`

The current storage surface has five documented local upload prefixes:

- `/uploads/chat`
- `/uploads/sounds`
- `/uploads/catalog-images`
- `/uploads/profile-avatars`
- `/uploads/designs`

Durability is mixed:

- Profile avatars are already Postgres-blob-primary for new writes through
  `profile_avatar_blobs`, with local legacy fallback.
- Design files are already Postgres-blob-primary for new writes through
  `design_file_blobs`, with local legacy fallback.
- Chat uploads, sound files, and catalog images still use local filesystem
  primary storage plus Postgres metadata.

The safest first implementation slice is:

1. Add Postgres blob primary storage for new chat uploads only.
2. Keep `/uploads/chat/*` public URLs compatible.
3. Keep local disk fallback for old chat files.
4. Do not backfill or delete old local files in the first implementation task.

Reason: chat upload metadata is already centralized in `chat_messages.metadata`,
file size is capped at 10MB, route tests already assert storage metadata, and
operator impact from missing attachments is higher than missing generated
catalog images. Sounds are larger, and catalog images touch more catalog/page
tables.

No schema, env, bucket, dependency, CI, deployment, or app behavior changes were
made in this task.

## Local Upload Surface

Source of truth: `config/storageSurface.js`.

Current structural check:

```text
Storage surface check passed: 5 local upload paths, 0 remote buckets, 1 static mounts.
```

Local file inventory at discovery time:

| Local directory | Exists | Files | Bytes | Notes |
| --- | ---: | ---: | ---: | --- |
| `uploads/chat` | yes | 1 | 0 | Only `.gitkeep`; no real local upload content found. |
| `uploads/sounds` | yes | 0 | 0 | No real local upload content found. |
| `uploads/catalog-images` | no | 0 | 0 | Directory absent locally. |
| `uploads/profile-avatars` | no | 0 | 0 | Directory absent locally; new writes should be Postgres-backed. |
| `uploads/designs` | yes | 1 | 0 | Only `.gitkeep`; no real local upload content found. |

The local inventory only proves this checkout has no real uploaded binary files.
It does not prove the live database has no rows pointing to local upload URLs.

## Static Public Mounts

Source: `server.js`.

Relevant order:

- `app.get('/uploads/designs/:filename', ...)` tries Postgres design blob reads
  first.
- `app.get('/uploads/profile-avatars/*', ...)` tries Postgres avatar blob reads
  first.
- `app.use('/uploads', express.static(path.join(__dirname, 'uploads')))` serves
  the legacy/fallback local upload tree.

Implication:

- `designs` and `profile-avatars` already have a durable read path before the
  generic static mount.
- `chat`, `sounds`, and `catalog-images` currently fall directly to local static
  files for binary reads.

## Service Ownership

| Public prefix | Owner | Route | Service | Current binary primary | Durable metadata/source |
| --- | --- | --- | --- | --- | --- |
| `/uploads/chat` | chat | `routes/chat.js` | `services/chatUploadStorage.js` | local filesystem | `chat_messages.metadata` |
| `/uploads/sounds` | sound | `routes/music.js` | `services/audioStorage.js` | local filesystem | `sounds.file_path`, `sounds.url`, `sounds.storage_*` |
| `/uploads/catalog-images` | catalogs | `routes/catalogs.js` | `services/imageStorage.js` | local filesystem | `catalog_items.image_url`, `catalog_pages.image_url`, `catalog_pages.background_url`, `catalog_definitions.cover_image_url` |
| `/uploads/profile-avatars` | profile | `routes/auth.js` | `services/profileAvatarStorage.js` | Postgres blob for new writes | `profile_avatar_blobs`, `user_profiles_ext.avatar_url` |
| `/uploads/designs` | designs | `routes/designs.js` | `services/designStorage.js` | Postgres blob for new writes | `design_file_blobs`, `designs.storage_*` |

## Route Entry Points

### Chat

Route:

- `POST /api/chat/channels/:id/upload`

Behavior:

- uses `multer.memoryStorage`;
- validates file type through `validateChatUploadFile`;
- calls `uploadChatFileWithFallback`;
- stores file metadata under `chat_messages.metadata.file`;
- returns public URL under `/uploads/chat/...`.

Current risk:

- binary content is local-only;
- metadata can survive in Postgres while the file disappears after filesystem
  reset/redeploy.

### Sounds

Routes:

- `POST /api/music/library/upload`
- generated/apply audio paths that call `_storeGeneratedAudio`
- `DELETE /api/music/library/:id`

Behavior:

- uses `multer.memoryStorage`;
- writes local audio with `uploadAudioBufferWithMetadata` or generated audio
  with `uploadAudioFromUrlWithMetadata`;
- inserts `sounds` rows with `file_path`, `url`, and `storage_*` columns;
- deletes local objects when `storage_provider='local'`.

Current risk:

- binary content is local-only;
- sound rows keep metadata, but playback URL can point to a missing local file;
- max upload size is 50MB, which makes Postgres blobs possible but less ideal
  than for smaller files.

### Catalog Images

Routes:

- `POST /api/catalogs/generate-image`
- `GET /api/catalogs/apply-image/:itemId/:taskId`
- catalog cover/page generation and update routes
- `POST /api/catalogs/:catalogId/bulk-generate-images`

Behavior:

- generated images are downloaded through `uploadFromUrl`;
- service writes to `/uploads/catalog-images/items/...`;
- DB stores URL strings in catalog item/page/definition columns.

Current risk:

- binary content is local-only;
- DB may retain `/uploads/catalog-images/...` URLs after files disappear;
- catalog image references are spread across multiple tables and code paths.

### Profile Avatars

Route:

- `POST /api/auth/profile/avatar/upload`

Behavior:

- uses `multer.memoryStorage`;
- stores new binary content in `profile_avatar_blobs`;
- writes public URL into `user_profiles_ext.avatar_url`;
- `/uploads/profile-avatars/*` first checks Postgres, then falls through to
  legacy local static handling.

Current risk:

- old local avatar URLs can still be missing;
- new writes are durable through Postgres.

### Designs

Routes:

- `POST /api/designs/upload`
- `GET /api/designs/:id/download`
- `DELETE /api/designs/:id`
- `POST /api/designs/:id/telegram`
- `GET /uploads/designs/:filename`

Behavior:

- upload route still receives files through `multer.diskStorage` into
  `uploads/designs`, then reads the temp/local file into Postgres;
- stores blob through `storeDesignBlob`;
- marks rows with `storage_provider='postgres'` and `storage_key`;
- deletes blob and any legacy local file on design delete;
- read path prefers Postgres blob and falls back to local file.

Current risk:

- old local-only design files can still be missing;
- new writes are durable through Postgres.

## DB Reference Map

Static migration/code evidence:

| Area | Tables/columns | Evidence |
| --- | --- | --- |
| Chat uploads | `chat_messages.metadata` JSONB | `033_messenger_v2.sql` adds `metadata`; `routes/chat.js` stores `metadata.file.url`, `storageProvider`, `storageKey`, `storagePath`, `storageUrl`. |
| Sounds | `sounds.file_path`, `sounds.url`, `sounds.storage_provider`, `sounds.storage_bucket`, `sounds.storage_key`, `sounds.storage_url`, `sounds.storage_migrated_at` | `117_sound_module.sql`, `122_sound_upgrades.sql`, `162_sounds_storage_metadata.sql`, `routes/music.js`. |
| Catalog items | `catalog_items.image_url` | `093_catalogs.sql`, `routes/catalogs.js`. |
| Catalog pages | `catalog_pages.image_url`, `catalog_pages.background_url` | `127_catalog_pages.sql`, later catalog page routes. |
| Catalog page history | `catalog_page_history.image_url` | `136_catalog_automations.sql`, page history insert in `routes/catalogs.js`. |
| Catalog definitions | `catalog_definitions.cover_image_url` | `135_catalog_enhancements.sql`, cover image application in `routes/catalogs.js`. |
| Profile avatars | `profile_avatar_blobs.data`, `profile_avatar_blobs.storage_key`, `user_profiles_ext.avatar_url` | `266_profile_avatar_postgres_storage.sql`, `routes/auth.js`, `services/profileAvatarStorage.js`. |
| Designs | `design_file_blobs.data`, `design_file_blobs.storage_key`, `designs.storage_provider`, `designs.storage_key` | `246_design_postgres_storage.sql`, `routes/designs.js`, `services/designStorage.js`. |

Live DB queries were not run. Without confirmed disposable DB credentials, a
read-only orphan/missing-file query could accidentally inspect production-like
data. That should be a separate approved operator step.

## Existing Test Coverage

Focused tests run during this discovery:

```text
node --test tests/chat-upload-storage.test.js tests/chat-upload-route.test.js
tests: 7, pass: 7, fail: 0
```

```text
node --test tests/audio-storage.test.js tests/image-storage.test.js tests/profile-avatar-storage.test.js tests/design-storage.test.js
tests: 13, pass: 13, fail: 0
```

Coverage by area:

| Area | Test files | What is covered |
| --- | --- | --- |
| Chat | `tests/chat-upload-storage.test.js`, `tests/chat-upload-route.test.js` | file policy, local storage metadata, metadata stored on chat message, SVG rejection, non-member rejection. |
| Sounds | `tests/audio-storage.test.js` | local metadata for manual/generated audio, empty-buffer rejection, local delete helper. |
| Catalog images | `tests/image-storage.test.js` | local generated image storage and unsafe filename normalization. |
| Profile avatars | `tests/profile-avatar-storage.test.js` | Postgres blob writes, local fallback, Postgres read handler, fallback pass-through, file policy. |
| Designs | `tests/design-storage.test.js` | Postgres storage key/metadata and public URL compatibility. |

Structural guard:

- `npm run check:storage-surface` verifies storage manifest/docs/.gitignore
  alignment and known upload segments.

## Durability Risks

### High

- Chat attachments can disappear while durable chat message metadata remains.
  Users will see historical messages with broken `/uploads/chat/...` links.

### Medium

- Sound library files can disappear while `sounds` rows remain. This can break
  playback, generated audio reuse, and sound-project tracks.
- Catalog images can disappear while catalog item/page URLs remain. This can
  degrade catalog/public visual surfaces.

### Lower

- New profile avatar uploads are already Postgres-backed. Risk is limited to old
  local-only avatar URLs.
- New design uploads are already Postgres-backed. Risk is limited to old
  local-only design files and any temporary disk path during upload processing.

## Orphan And Missing Reference Findings

Local filesystem findings:

- no real local upload files were found in this checkout;
- only zero-byte `.gitkeep` placeholders were present in `uploads/chat` and
  `uploads/designs`;
- therefore no local orphan binary files can be identified from this checkout.

DB reference findings:

- live DB rows were not queried;
- missing-file rows cannot be confirmed without a known disposable DB;
- likely reference surfaces are listed in the DB Reference Map.

Recommended read-only SQL for a confirmed disposable/local DB:

```sql
-- Chat upload references
SELECT id, channel_id, metadata #>> '{file,url}' AS file_url
FROM chat_messages
WHERE metadata #>> '{file,url}' LIKE '/uploads/chat/%';

-- Sound upload references
SELECT id, name, file_path, url, storage_provider, storage_key
FROM sounds
WHERE file_path LIKE '/uploads/sounds/%'
   OR url LIKE '/uploads/sounds/%'
   OR storage_url LIKE '/uploads/sounds/%';

-- Catalog image references
SELECT id, catalog_id, name, image_url
FROM catalog_items
WHERE image_url LIKE '/uploads/catalog-images/%';

SELECT id, catalog_id, page_number, image_url, background_url
FROM catalog_pages
WHERE image_url LIKE '/uploads/catalog-images/%'
   OR background_url LIKE '/uploads/catalog-images/%';

SELECT id, cover_image_url
FROM catalog_definitions
WHERE cover_image_url LIKE '/uploads/catalog-images/%';

-- Legacy profile avatar references
SELECT username, avatar_url
FROM user_profiles_ext
WHERE avatar_url LIKE '/uploads/profile-avatars/%';

-- Legacy/local design references
SELECT id, filename, storage_provider, storage_key
FROM designs
WHERE COALESCE(storage_provider, 'local') <> 'postgres';
```

## First Implementation Slice Recommendation

Recommended first slice:

```text
Chat Postgres blob primary for new uploads, with /uploads/chat legacy fallback.
```

Implementation shape for a later protected task:

1. Add a migration for `chat_upload_blobs`.
2. Store new chat upload binary content in Postgres.
3. Keep public URL shape under `/uploads/chat/...`.
4. Add a `GET /uploads/chat/*` handler before the static `/uploads` mount.
5. Fall back to local disk when no Postgres blob exists.
6. Keep `chat_messages.metadata.file` shape compatible.
7. Do not backfill old local files in the first task.
8. Add focused tests for:
   - Postgres blob write;
   - `/uploads/chat/*` Postgres read;
   - local fallback;
   - metadata compatibility;
   - upload cleanup/error behavior.

Why chat first:

- user impact is high: broken chat attachments damage historical team context;
- max file size is 10MB, lower risk than 50MB audio blobs;
- current metadata already has `storageProvider`, `storageKey`, `storagePath`,
  and `storageUrl`;
- existing focused route tests are already close to the desired contract;
- rollback is clean if the public URL and local fallback remain unchanged.

## Rejected Options

| Option | Decision | Reason |
| --- | --- | --- |
| Move all upload paths to Postgres at once | reject | Too much blast radius across chat, sounds, catalogs, profile, designs, routes, tests, and migration strategy. |
| Start with sounds Postgres blobs | defer | Sound files can be up to 50MB; DB bloat and streaming behavior need a more deliberate design. |
| Start with catalog images | defer | References are spread across catalog items, pages, page history, and definition cover fields. |
| Rework profile avatars first | reject | New avatar writes are already Postgres-backed. Only legacy cleanup remains. |
| Rework designs first | reject | New design writes are already Postgres-backed. Only legacy cleanup remains. |
| Railway persistent volume | defer/reject for first slice | Infrastructure/deploy protected area; helps one hosting shape but does not solve portability or multi-instance behavior. |
| Remote bucket first | defer | Best long-term fit for large audio/images, but introduces provider/env/secret/integration surface. |
| Delete local upload directories | reject | Explicitly unsafe until DB references and legacy rows are migrated or confirmed obsolete. |

## Protected Changes Needed Later

The actual implementation task will require explicit confirmation because it
touches protected areas:

- database schema/migration;
- binary storage behavior;
- public upload read handlers;
- potentially production data backfill if migration is requested later.

Do not combine the first implementation slice with:

- Railway/deploy config changes;
- remote storage provider setup;
- bulk file migration;
- production data cleanup;
- unrelated refactors.

## Rollback Strategy For Future Chat Slice

If the chat implementation is done later, rollback should be:

1. Stop writing new blobs by reverting service/route changes.
2. Keep local fallback route/static behavior intact.
3. Leave `chat_upload_blobs` table in place until any newly uploaded files are
   exported or confirmed disposable.
4. Do not drop blob data as part of an app rollback.
5. Drop schema only in a separate operator-approved cleanup.

## Verification

Commands run:

```bash
git status --short --branch
Get-ChildItem -Recurse uploads\chat -File -ErrorAction SilentlyContinue | Measure-Object
Get-ChildItem -Recurse uploads\sounds -File -ErrorAction SilentlyContinue | Measure-Object
Get-ChildItem -Recurse uploads\catalog-images -File -ErrorAction SilentlyContinue | Measure-Object
Get-ChildItem -Recurse uploads\profile-avatars -File -ErrorAction SilentlyContinue | Measure-Object
Get-ChildItem -Recurse uploads\designs -File -ErrorAction SilentlyContinue | Measure-Object
npx -y -p node@22 -p npm@10 -c "npm run check:storage-surface"
npx -y -p node@22 -p npm@10 -c "node --test tests/chat-upload-storage.test.js tests/chat-upload-route.test.js"
npx -y -p node@22 -p npm@10 -c "node --test tests/audio-storage.test.js tests/image-storage.test.js tests/profile-avatar-storage.test.js tests/design-storage.test.js"
```

Results:

- storage surface check passed;
- chat focused tests passed: 7/7;
- audio/image/profile-avatar/design focused tests passed: 13/13;
- no git-visible upload artifacts remained after focused tests.

Run for this document:

```bash
git diff --check -- docs/UPLOAD_DURABILITY_DISCOVERY_2026-06-28.md
npx -y -p node@22 -p npm@10 -c "npm run check:storage-surface"
npx -y -p node@22 -p npm@10 -c "npm run check:syntax"
```

## Rollback

Delete:

```text
docs/UPLOAD_DURABILITY_DISCOVERY_2026-06-28.md
```

No app behavior, schema, CI, env, dependency, deployment, bucket, or production
data changes were made.
