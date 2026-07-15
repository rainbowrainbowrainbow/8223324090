# Hermes Worker Contract And Operating Packet

This document is the worker-facing contract and daily operating packet for
Hermes integration with EventGenix CRM job and staff-schedule endpoints.

Production impact: yes for the paired CRM implementation; this document only
describes the worker contract and approval gates.

## Scope

CRM is the source of truth for durable Hermes jobs. Hermes is a worker that can
read the queue, claim jobs, post status, return results, and record decisions.
Generated output is always review-first: the job contract does not auto-apply or
auto-publish assets.

CRM is also the source of truth for staff matching, current schedule state,
conflict classification, and schedule writes. Hermes owns photo intake and OCR,
but must never guess a staff match or write a schedule without CRM preview and
explicit user approval.

Supported job types:

- `creative_material_job`
- `menu_photo_job`

Supported statuses:

```text
queued, claimed, in_progress, needs_input, ready_for_review,
revision_requested, approved, rejected, failed, cancelled
```

## Accepted Operating Flows

### creative_material_job

Accepted flow:

1. CRM creates a `creative_material_job`.
2. Hermes claims the job.
3. Hermes posts `status` updates.
4. Hermes posts `result` with `imageBase64` final asset data.
5. CRM stores the final image in `catalog_image_blobs`.
6. CRM returns a same-origin preview URL under `/uploads/catalog-images/items/...`.
7. A human reviews the creative result in Hermes Studio.

Accepted evidence:

- Creative `jobId=3` ingestion preview: PASS.
- Preview rendered from CRM storage, not a provider/temp URL.
- Creative final asset storage path: `/uploads/catalog-images/items/...`.

### menu_photo_job

Accepted draft-only flow:

1. CRM creates or queues a `menu_photo_job`.
2. Hermes claims the job and posts status/result.
3. CRM stores the image as a reviewable menu photo draft.
4. CRM does not update the active product image.
5. A manager must separately apply or reject the draft.

Accepted evidence:

- Menu `jobId=4` draft-only flow: PASS.
- Product `menu_2026_017_baby` `iconUrl` remained `null`.
- Draft image URL
  `/uploads/catalog-images/items/menu-menu-017-1783289069584.png` returned
  `200 image/png`.

## Separate Approval Gates

These actions are outside automatic worker execution and require separate
explicit approval:

- Apply a menu photo draft to a product.
- Approve or reject a creative final asset.
- Request edit or regenerate a creative job.
- Enable auto-worker/gateway live mode.
- Deploy application changes.
- Run migrations.

## Auth And Headers

All `/api/hermes/*` requests must use the Hermes integration secret.

```http
Accept: application/json
Content-Type: application/json
User-Agent: Hermes-Agent/Event-Genix-CRM-Integration
x-api-key: <HERMES_API_KEY>
X-Integration-Id: hermes-event-genix-crm
X-Hermes-Run-Id: <stable-worker-run-id>
```

Header rules:

- `x-api-key` is required for Hermes auth.
- `X-Integration-Id` is optional for existing low-risk routes, but schedule
  apply requires the exact value `hermes-event-genix-crm`.
- `X-Hermes-Run-Id` is a non-secret correlation header for worker logs and
  incident review. It is not currently an auth gate.
- Do not log or echo `x-api-key`, bearer tokens, cookies, or secrets.

All endpoints that change CRM business state also require:

```http
Idempotency-Key: <fresh-unique-key>
X-Hermes-User-Confirmed: true
```

Mutation idempotency rules:

- Use a fresh `Idempotency-Key` for each logical mutation.
- Retry the same key only for the exact same method, path, and JSON body when
  the first attempt may have reached CRM.
- Never reuse a failed validation/auth key for a changed body.
- Never reuse keys across different jobs, endpoints, assets, or decisions.
- Schedule preview is preview-only and does not require confirmation or an
  idempotency key; staff create and schedule apply require both.

## Endpoints

| Method | Endpoint | Purpose | Mutation headers |
| --- | --- | --- | --- |
| `GET` | `/api/hermes/jobs/queue` | List claimable jobs. Supports `jobType`, `businessContext`, and `limit` query params. | No |
| `GET` | `/api/hermes/jobs/:id` | Read one job with assets, history, and decisions. | No |
| `POST` | `/api/hermes/jobs` | Create a durable Hermes job. | Yes |
| `POST` | `/api/hermes/jobs/:id/claim` | Claim a queued job for a worker. | Yes |
| `POST` | `/api/hermes/jobs/:id/status` | Post worker status. | Yes |
| `POST` | `/api/hermes/jobs/:id/result` | Post worker result and assets. | Yes |
| `POST` | `/api/hermes/jobs/:id/decision` | Record a human or operator decision. | Yes |
| `GET` | `/api/hermes/staff` | Read sanitized scheduleable staff. | No |
| `POST` | `/api/hermes/staff` | Create one staff record. Schedule remains untouched. | Yes, plus exact integration id and `manage_staff` |
| `GET` | `/api/hermes/staff-schedule` | Read current schedule cells for at most 31 days. | No |
| `POST` | `/api/hermes/staff-schedule/preview` | Validate OCR rows and create an immutable 30-minute preview. | No schedule writes |
| `POST` | `/api/hermes/staff-schedule/apply` | Apply selected preview rows atomically. | Yes, plus exact integration id and `manage_staff` |

### Staff Create Command UX

The final confirmed create call must use all three mutation headers:

```http
POST /api/hermes/staff
X-Integration-Id: hermes-event-genix-crm
X-Hermes-User-Confirmed: true
Idempotency-Key: <fresh-key-for-this-create>
```

```json
{
  "name": "Плющкіт",
  "department": "animators",
  "position": "Аніматор",
  "roleType": "animator",
  "hireDate": "2026-07-15",
  "color": "#8B5CF6"
}
```

The endpoint may also receive `role_type`, `secondaryProfessions` or
`secondary_professions`, and optional `telegramUsername` without retaining its
leading `@`. It must return the sanitized staff envelope and
`staffWrites: 1`, `scheduleWrites: 0`, `scheduleTouched: false`.

Hermes owner-facing messages for natural commands must be short and explicit:

- Already exists: `Плющкіт вже є в CRM (#<staffId>). Нічого не дублюю.`
- Missing approval: `Це створення працівника в CRM. Підтверди: створити <name> як <position>, графік не чіпати.`
- Created roster-only: `<name> створено у списку персоналу. Графік не змінювався.`
- Schedule fields present in staff-create request: `Працівника можна створити окремо, а графік — окремим підтвердженням з датою і часом.`
- Missing schedule date/time after the phrase “в графік”: `Для графіка не вистачає дати/часу. Напиши, наприклад: сьогодні 10:00–20:00.`

Do not silently treat a staff-create approval as approval to edit the schedule.

## Staff Schedule OCR Skill And Router Handoff

Hermes should implement this as a dedicated skill/router, for example
`eventgenix_staff_schedule_ocr`. The skill needs four CRM capabilities:

```json
{
  "requiredActions": [
    "staff.read",
    "staff.create",
    "staff_schedule.read",
    "staff_schedule.preview",
    "staff_schedule.apply"
  ],
  "businessContext": "event_genix",
  "maxPreviewRows": 100,
  "previewTtlMinutes": 30,
  "applyRequiresHumanConfirmation": true
}
```

### Router States

```text
photo_received
  -> ocr_extracted
  -> crm_preview_created
  -> user_review_required
  -> user_confirmed
  -> crm_apply_completed
```

Terminal or restart states:

```text
needs_input, cancelled, preview_expired, preview_stale, permission_blocked,
apply_failed_retryable
```

Persist only non-secret correlation data required to resume the conversation:

- CRM `previewId` and `expiresAt`;
- CRM preview `rowId` values and classifications;
- selected row IDs and separately confirmed conflict row IDs;
- the apply `Idempotency-Key` after confirmation;
- a stable Telegram update/file reference without image binary.

Do not persist the Hermes API key, cookies, raw headers, Telegram bot token, or
photo binary in the skill state.

### OCR Input To CRM Preview

Optional sanitized reads return these wrappers:

```json
{
  "success": true,
  "items": [
    {
      "staffId": 123,
      "name": "CRM Staff Name",
      "displayName": "CRM Staff Name",
      "department": "operations",
      "position": "Staff",
      "professions": ["animator"],
      "scheduleable": true
    }
  ],
  "pagination": {
    "nextCursor": null,
    "hasMore": false,
    "limit": 50
  }
}
```

```json
{
  "success": true,
  "items": [
    {
      "staffId": 123,
      "date": "2026-07-15",
      "status": "working",
      "startTime": "10:00",
      "endTime": "19:00",
      "note": null,
      "professionKey": "animator",
      "stateHash": "<sha256>"
    }
  ],
  "meta": {
    "businessContext": "event_genix",
    "dateFrom": "2026-07-15",
    "dateTo": "2026-07-15",
    "days": 1
  }
}
```

Hermes sends OCR JSON, not the photographed file:

```http
POST /api/hermes/staff-schedule/preview
X-API-Key: <secret>
Content-Type: application/json
```

```json
{
  "documentDate": "2026-07-14",
  "sourceReference": {
    "telegram": {
      "chatId": "<chat-reference>",
      "messageId": "<message-reference>",
      "fileUniqueId": "<file-reference>"
    }
  },
  "rows": [
    {
      "employeeName": "Employee Name From Form",
      "date": "2026-07-15",
      "startTime": "10:00",
      "endTime": "19:00",
      "status": "working",
      "note": null,
      "confidence": 0.96,
      "issues": []
    }
  ]
}
```

Accepted statuses are `working`, `remote`, `dayoff`, `vacation`, and `sick`.
Times use `HH:MM`. `working` requires both times; `dayoff`, `vacation`, and
`sick` must not include times. Maximum input is 100 rows.

CRM returns one classification per row:

- `create`, `update`, `no_change`: selectable;
- `conflict`: selectable only after separate user confirmation;
- `invalid`, `staff_not_found`, `ambiguous_staff`: never selectable.

Hermes must assert `scheduleWrites === 0` before presenting a preview. CRM
matching is authoritative even when OCR confidence is high. Do not fuzzy-match
or replace CRM classifications locally.

Preview response wrapper:

```json
{
  "success": true,
  "importId": "hsi_01J...",
  "status": "ready",
  "created": true,
  "replayed": false,
  "documentDate": "2026-07-14",
  "expiresAt": "2026-07-14T12:30:00.000Z",
  "previewHash": "<sha256>",
  "rows": [
    {
      "rowId": "hsr_aaaaaaaaaaaaaaaaaaaaaaaa",
      "action": "create",
      "employeeName": "Employee Name From Form",
      "matchedStaff": {
        "staffId": 123,
        "name": "CRM Staff Name",
        "scheduleable": true
      },
      "proposedState": {
        "staffId": 123,
        "date": "2026-07-15",
        "status": "working",
        "startTime": "10:00",
        "endTime": "19:00",
        "note": null
      },
      "expectedCurrentState": null,
      "stateHash": "<sha256>",
      "issues": []
    }
  ],
  "summary": {
    "create": 1,
    "update": 0,
    "no_change": 0,
    "conflict": 0,
    "staff_not_found": 0,
    "ambiguous_staff": 0,
    "invalid": 0
  },
  "scheduleWrites": 0
}
```

### User Review Message

Show a compact summary grouped by classification. For every conflict show the
current and proposed status/time. For missing, ambiguous, or invalid rows show
the CRM issue and ask the user to correct the form or choose a CRM-recognized
name. Never expose hidden HR fields or raw CRM rows.

The confirmation event must identify the exact `previewId`, selected `rowId`
values, and conflict row IDs the user explicitly accepted. A generic earlier
message such as "yes" must not approve a different or regenerated preview.

### Confirmed Apply

```http
POST /api/hermes/staff-schedule/apply
X-API-Key: <secret>
X-Integration-Id: hermes-event-genix-crm
X-Hermes-User-Confirmed: true
Idempotency-Key: <one-key-for-this-logical-apply>
Content-Type: application/json
```

```json
{
  "previewId": "hsi_01J...",
  "selectedRowIds": ["hsr_aaaaaaaaaaaaaaaaaaaaaaaa"],
  "conflictConfirmed": []
}
```

The body must contain only those three keys. Never send employee names, times,
statuses, `stateHash`, or a `proposedMutationPayload` to apply; CRM reloads the
immutable states saved by preview.

The configured Hermes actor must already have `manage_staff`. The skill must
not attempt to grant, simulate, or bypass that permission.

Successful apply returns `status: "applied"`, `selectedCount`, `appliedCount`,
`noChangeCount`, `scheduleWrites`, affected `dates`, and a result for every
selected row. The worker should persist this response as the terminal result of
the logical apply.

### Retry And Error Decisions

| Result | Hermes behavior |
| --- | --- |
| Preview `scheduleWrites` is not `0` | Stop and raise an integration safety incident. |
| `invalid`, `staff_not_found`, `ambiguous_staff` | Do not apply the row; ask for correction. |
| `HERMES_SCHEDULE_APPLY_CONFLICT_CONFIRMATION_REQUIRED` | Ask for explicit confirmation of that conflict row. |
| `HERMES_SCHEDULE_APPLY_PREVIEW_EXPIRED` | Create a new preview and ask again. |
| `HERMES_SCHEDULE_APPLY_STALE` | Never overwrite; read current state, create a new preview, and ask again. |
| `HERMES_SCHEDULE_IMPORT_ALREADY_APPLIED` | Do not issue another apply; reconcile with the stored local operation. |
| `HERMES_MANAGE_STAFF_REQUIRED` | Stop and hand off to a CRM administrator. |
| Network loss or `5xx` after apply was sent | Retry the identical body with the same idempotency key. |
| `IDEMPOTENCY_KEY_CONFLICT` | Stop; the key was reused with a different request. |

All errors use this stable wrapper; branch on `code`, never on `error` text:

```json
{
  "success": false,
  "error": "Human-readable message",
  "code": "HERMES_SCHEDULE_APPLY_STALE",
  "meta": {
    "rowId": "hsr_aaaaaaaaaaaaaaaaaaaaaaaa"
  }
}
```

### Minimal End-To-End Sequence

```text
GET  /api/hermes/capabilities
GET  /api/hermes/staff?limit=50
GET  /api/hermes/staff-schedule?dateFrom=YYYY-MM-DD&dateTo=YYYY-MM-DD
POST /api/hermes/staff-schedule/preview
-- present preview and wait for explicit user approval --
POST /api/hermes/staff-schedule/apply
```

The first three requests are read-only. Preview stores import metadata but must
return `scheduleWrites: 0`. Only the final confirmed apply changes the schedule.

This schedule skill is independent of EventGenix warehouse photo intake. Do
not change, reroute, or reuse warehouse photo endpoints for schedule forms.

## Creative Material Job

Use `creative_material_job` for posters, flyers, social posts, stories,
banners, and other marketing materials.

### Create Payload

```json
{
  "jobType": "creative_material_job",
  "businessContext": "event_genix",
  "title": "Summer poster",
  "sourceEntity": {
    "type": "hermes_studio",
    "id": "studio-request-123"
  },
  "payload": {
    "brief": "Create one clean summer poster.",
    "title": "Summer poster",
    "materialType": "poster",
    "formatSize": "1080x1350",
    "requirements": "Readable title, safe margins, bright event mood.",
    "deadline": "2026-07-06T12:00:00.000Z",
    "priority": "normal",
    "references": [
      "https://example.com/reference"
    ],
    "comment": "Keep copy short."
  }
}
```

Minimum input: `payload` must provide at least one useful creative brief field,
such as `brief`, `title`, `materialType`, or `format`.

### Status Payload

```json
{
  "status": "in_progress",
  "message": "Worker started rendering.",
  "externalEventId": "hermes-run-20260706-001-status-1",
  "payload": {
    "workerId": "hermes-worker-1"
  }
}
```

Worker status values accepted by the status endpoint:

```text
claimed, in_progress, needs_input, ready_for_review, failed, cancelled
```

### Result Payload With imageBase64

For final creative image assets, prefer `imageBase64`. CRM decodes the bytes,
validates the MIME signature, stores the image in `catalog_image_blobs`, and
returns a same-origin URL under `/uploads/catalog-images/items/...`.

```json
{
  "status": "ready_for_review",
  "summary": "Creative asset ready.",
  "externalEventId": "hermes-run-20260706-001-result-1",
  "result": {
    "notes": "Generated one safe CRM-stored preview."
  },
  "assets": [
    {
      "externalAssetId": "creative-final-1",
      "assetType": "result",
      "role": "final",
      "imageBase64": "<base64 image bytes or data:image/png;base64,...>",
      "mimeType": "image/png",
      "metadata": {
        "width": 1080,
        "height": 1350
      }
    }
  ]
}
```

Accepted image MIME/signatures:

- `image/png`: bytes must start with the PNG signature.
- `image/jpeg` or `image/jpg`: bytes must start with JPEG SOI bytes.
- `image/webp`: bytes must use `RIFF` plus `WEBP` signature.

Do not send both `imageBase64` and `url`/`storageKey` for the same asset.

### Returned Asset Shape

Expected response asset after successful `imageBase64` ingestion:

```json
{
  "id": 123,
  "jobId": 3,
  "assetType": "result",
  "role": "final",
  "externalAssetId": "creative-final-1",
  "url": "/uploads/catalog-images/items/hermes-creative-job-3-creative-final-1-<checksum>.png",
  "storageKey": "hermes-creative-job-3-creative-final-1-<checksum>.png",
  "mimeType": "image/png",
  "checksumSha256": "<64-char-sha256>",
  "metadata": {
    "width": 1080,
    "height": 1350,
    "storageProvider": "postgres",
    "storageBucket": "catalog_image_blobs",
    "sourceProvider": "hermes",
    "sourceJobType": "creative_material_job",
    "sourceJobId": "3",
    "sourceAssetExternalId": "creative-final-1",
    "sourceAssetRole": "final",
    "checksumSha256": "<64-char-sha256>",
    "sizeBytes": 123456
  }
}
```

### Storage Contract

- Public final asset URLs must be same-origin paths.
- Durable creative images are stored in Postgres table `catalog_image_blobs`.
- Public URL format is `/uploads/catalog-images/items/<filename>`.
- CRM serves `/uploads/catalog-images/items/:filename` from Postgres first, with
  local upload fallback for legacy/dev files.
- Final creative assets must not be provider URLs, temporary URLs, `data:` URLs,
  `local://` URLs, or protocol-relative URLs.

### Revision Requested Decision

```json
{
  "decision": "revision_requested",
  "notes": "Request edit: increase CTA contrast and reduce text.",
  "externalDecisionId": "hermes-run-20260706-001-revision-1",
  "payload": {
    "surface": "hermes_studio",
    "action": "request_edit"
  }
}
```

`revision_requested` records the decision and updates job history. It does not
publish, apply, or replace any CRM entity asset.

## Menu Photo Job

Use `menu_photo_job` for dish/menu catalog photos.

Current supported flow:

1. CRM or an approved operator creates or queues a `menu_photo_job`.
2. Hermes reads `/api/hermes/jobs/queue` and claims the job.
3. Hermes posts `status` updates.
4. Hermes posts `result` with a final image reference.
5. CRM stores the result as a reviewable menu image draft.
6. A manager uses the existing CRM product/menu image apply or reject action.

Menu photo result behavior:

- `ready_for_review` result must include `result.imageUrl`,
  `result.imageBase64`, or a result asset URL.
- The result route updates only the review draft path
  `products.ai_card_draft.imageStudio`.
- The result route does not update `products.icon_url`.
- No auto-apply is allowed without explicit human approval.

Live smoke note: menu photo live smoke requires an explicit disposable
`PRODUCT_ID`. Do not run a live menu-photo smoke against production-like data
without that ID and explicit approval.

## Safety Rules

- No `autoApply`.
- No `autoPublish`.
- No `dummyimage.com` final assets.
- No provider, temporary, protocol-relative, `data:`, or `local://` URLs as
  final creative assets.
- Use same-origin `/uploads/catalog-images/items/...` for final CRM assets.
- Use a fresh `Idempotency-Key` per logical mutation.
- Never reuse failed keys for changed requests.
- Do not print secrets in logs, payloads, screenshots, test output, docs, or
  support messages.
- Do not include raw CRM rows, auth headers, cookies, customer data, or provider
  secrets in `payload`, `result`, `metadata`, or worker logs.

## Known Limits

- `POST /api/hermes/jobs/:id/result` JSON body limit is `20mb`.
- Decoded image limit is `12 MiB` per asset.
- Multiple assets must fit the total `20mb` JSON body limit after base64
  expansion.
- Result assets per result are capped by CRM validation.
- `imageBase64` ingestion is supported only for `creative_material_job` result
  assets in this job contract.

## Minimal Worker Sequence

```text
GET  /api/hermes/jobs/queue?jobType=creative_material_job&businessContext=event_genix
POST /api/hermes/jobs/:id/claim
POST /api/hermes/jobs/:id/status
POST /api/hermes/jobs/:id/result
POST /api/hermes/jobs/:id/decision
GET  /api/hermes/jobs/:id
```

Every `POST` in the sequence must include `Idempotency-Key` and
`X-Hermes-User-Confirmed: true`.
