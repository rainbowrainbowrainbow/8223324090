# Hermes Worker Contract And Operating Packet

This document is the worker-facing contract and daily operating packet for
Hermes integration with EventGenix CRM Hermes job endpoints.

Production impact: yes for the paired CRM implementation; this document only
describes the worker contract and approval gates.

## Scope

CRM is the source of truth for durable Hermes jobs. Hermes is a worker that can
read the queue, claim jobs, post status, return results, and record decisions.
Generated output is always review-first: the job contract does not auto-apply or
auto-publish assets.

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
- `X-Integration-Id` is optional in code, but if present it must be
  `hermes-event-genix-crm`.
- `X-Hermes-Run-Id` is a non-secret correlation header for worker logs and
  incident review. It is not currently an auth gate.
- Do not log or echo `x-api-key`, bearer tokens, cookies, or secrets.

All mutation endpoints also require:

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
