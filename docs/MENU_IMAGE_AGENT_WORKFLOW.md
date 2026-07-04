# Menu Image Agent Workflow

Date: 2026-07-02
Scope: Hermes/manual workflow for kitchen menu item images.
Default policy: create a reviewable draft only. Do not auto-apply generated images.

## Purpose

Kitchen menu item photos can be prepared by an external agent such as Hermes or by a CRM operator. The CRM stores the submitted image as a draft under `products.ai_card_draft.imageStudio`. The active booking/menu catalog image changes only after the existing apply action copies the draft image into `products.icon_url`.

This workflow is for kitchen products where:

- `domain = 'kitchen'`
- `kitchen_type = 'menu'`
- product is active and not hidden

## Storage And Image Priority

External drafts are saved to the CRM catalog image upload URL surface:

```text
/uploads/catalog-images/items/<generated-file-name>
```

New writes persist the binary image in Postgres `catalog_image_blobs`. The local
`uploads/catalog-images` filesystem is only a legacy/dev fallback and is not the
durable source on Railway. If a catalog image upload URL is missing from both
Postgres and the legacy local fallback, the server must return 404, not CRM
HTML.

The active source of truth for new Hermes/manual menu photos is:

```text
products.icon_url -> API iconUrl/icon_url -> booking/program UI image
```

Creating an external draft does not change the active image. Applying the draft
changes `products.icon_url`.

The static `js/kitchen-menu-images.js` manifest is legacy/static compatibility
only. It is not the source of truth for new Hermes photos and must not be used
to "recover" a failed or missing generated menu image. If `iconUrl`/`icon_url`
is absent or broken, the booking menu UI must show its emoji/missing-image state
instead of falling back to an old static product photo.

Default Hermes/menu-photo size is `1536x1024` (`3:2`). The booking menu card is
designed for that format. `1024x1024` and `1024x1536` remain allowed only when a
human explicitly selects a different supported size.

Do not use `images/kitchen-menu/products/menu-031.jpg` as the correct
Margherita photo. That file belongs to the old static batch and is not a valid
fallback for `MENU-031` / `menu_2026_031_item`.

## Product API

Product routes are for the CRM UI or authenticated CRM operators. They use the normal CRM auth headers and business context handling.

### Get Generation Context

```http
GET /api/products/:id/menu-image/context?businessContext=event_genix
```

Successful response shape:

```json
{
  "success": true,
  "product": {
    "id": "menu_burger_001",
    "code": "MENU-BURGER-001",
    "name": "Kids Burger",
    "menuSection": "Burgers",
    "shortDescription": "Soft bun with chicken cutlet",
    "description": "Menu-facing product description",
    "ingredients": "bun, chicken, cheese, sauce",
    "techCard": "Internal kitchen notes for generation context",
    "weightValue": "220 g",
    "servingUnit": "portion",
    "price": 260,
    "allergens": [
      {
        "key": "gluten",
        "label": "Gluten"
      }
    ],
    "currentImageUrl": "/uploads/catalog-images/items/current.png",
    "draftImageUrl": null
  },
  "imageRules": {
    "targetUsage": "booking_menu_catalog",
    "defaultSize": "1536x1024",
    "allowedSizes": ["1536x1024", "1024x1024", "1024x1536"],
    "defaultStyle": "catalog",
    "allowedStyles": ["catalog", "realistic", "clean-dark"],
    "styleRules": "Clean commercial menu catalog photo...",
    "backgroundRules": "Use a clean CRM-friendly food photography background...",
    "negativePrompt": "No text, letters, logo, watermark..."
  }
}
```

### Create External Draft

```http
POST /api/products/:id/menu-image/external-draft
Content-Type: application/json
```

Use exactly one image source: `imageUrl` or `imageBase64`.

Image URL payload:

```json
{
  "businessContext": "event_genix",
  "imageUrl": "https://cdn.example.test/menu-images/menu-burger-001.png",
  "prompt": "Clean commercial menu catalog photo of a kids burger...",
  "provider": "hermes",
  "model": "hermes-image-model",
  "size": "1536x1024",
  "style": "catalog",
  "source": "hermes"
}
```

Base64 payload:

```json
{
  "businessContext": "event_genix",
  "imageBase64": "data:image/png;base64,<base64_png_payload>",
  "prompt": "Clean commercial menu catalog photo of a kids burger...",
  "provider": "manual",
  "model": "browser-file-upload",
  "size": "1536x1024",
  "style": "catalog",
  "source": "manual"
}
```

Successful response shape:

```json
{
  "success": true,
  "status": "ready",
  "provider": "hermes",
  "model": "hermes-image-model",
  "imageUrl": "/uploads/catalog-images/items/menu-menu-burger-001-1782994000000.png",
  "prompt": "Clean commercial menu catalog photo of a kids burger...",
  "draft": {
    "version": 1,
    "status": "draft",
    "source": "stored",
    "aiAvailable": true,
    "generatedAt": "2026-07-02T09:00:00.000Z",
    "imageStudio": {
      "version": 1,
      "status": "ready",
      "source": "hermes",
      "imageUrl": "/uploads/catalog-images/items/menu-menu-burger-001-1782994000000.png",
      "prompt": "Clean commercial menu catalog photo of a kids burger...",
      "provider": "hermes",
      "model": "hermes-image-model",
      "size": "1536x1024",
      "style": "catalog",
      "generatedAt": "2026-07-02T09:00:00.000Z",
      "previousImageUrl": "/uploads/catalog-images/items/current.png",
      "storage": {
        "provider": "postgres",
        "bucket": "catalog_image_blobs",
        "publicUrl": "/uploads/catalog-images/items/menu-menu-burger-001-1782994000000.png"
      },
      "error": null
    }
  },
  "product": {
    "id": "menu_burger_001",
    "businessContext": "event_genix",
    "code": "MENU-BURGER-001",
    "name": "Kids Burger",
    "iconUrl": "/uploads/catalog-images/items/current.png"
  }
}
```

Important checks after draft creation:

- `status` is `ready`.
- `draft.imageStudio.status` is `ready`.
- `draft.imageStudio.imageUrl` points to `/uploads/catalog-images/items/...`.
- `product.iconUrl` is still the previous active image until apply.

## Hermes API

Hermes routes require Hermes authentication before both read and mutation
actions. Use either the configured `x-api-key` header or the configured bearer
fallback. Do not put real keys in docs, prompts, logs, screenshots, or task
notes.

### Required Environment

CRM server-side environment:

| Name | Required | Purpose |
| --- | --- | --- |
| `HERMES_API_KEY` | Yes | Shared secret expected by `/api/hermes/*` auth. Missing value makes Hermes routes return `503 HERMES_AUTH_NOT_CONFIGURED`. |
| `HERMES_ACTOR_USER_ID` | Yes | Active CRM user id used as the Hermes actor for DB reads/writes and business-scope checks. Missing/invalid value blocks Hermes routes before product lookup. |
| `HERMES_ALLOWED_BUSINESS_CONTEXTS` | Optional | Narrows the actor business contexts. When set for menu photos, it must include `event_genix`. |

Hermes agent/client runtime environment:

| Name | Required | Purpose |
| --- | --- | --- |
| `HERMES_API_KEY` | Preferred | Runtime key that the agent should send as `x-api-key` to CRM. |
| `EVENT_GENIX_CRM_API_KEY` | Acceptable alias only | May be used only when the runtime explicitly maps it to the outgoing `x-api-key` header. CRM does not read this name directly for `/api/hermes/*` auth. |

The runtime must send one of:

```http
x-api-key: <configured Hermes key>
Authorization: Bearer <configured Hermes key>
```

For `businessContext=event_genix`, the configured Hermes actor must have access
to `event_genix`. If `HERMES_ALLOWED_BUSINESS_CONTEXTS` is set, that allowlist
must also include `event_genix`. Mutations require a single writable business
scope; `all` and multi-context scopes are read-only.

Read routes do not require mutation headers. Mutation routes require:

```http
Idempotency-Key: <stable-unique-key-for-this-request-body>
X-Hermes-User-Confirmed: true
X-Integration-Id: hermes-event-genix-crm
```

Use the same `Idempotency-Key` only when retrying the same request body. Use a new key for a changed body or a new image.

### Get Generation Context

```http
GET /api/hermes/menu-photos/:productId/context?businessContext=event_genix
```

Successful response shape:

```json
{
  "success": true,
  "product": {
    "id": "menu_burger_001",
    "code": "MENU-BURGER-001",
    "name": "Kids Burger",
    "businessContext": "event_genix",
    "currentImageUrl": "/uploads/catalog-images/items/current.png",
    "draft": {
      "status": "draft",
      "imageUrl": null,
      "prompt": null,
      "provider": null,
      "model": null,
      "size": null,
      "style": null,
      "generatedAt": null,
      "approvedAt": null,
      "approvedBy": null,
      "appliedAt": null,
      "appliedBy": null,
      "rejectedAt": null,
      "rejectedBy": null,
      "previousImageUrl": null,
      "error": null
    },
    "crm_url": "https://crm.example.test/programs.html#kitchen-menu:menu_burger_001"
  },
  "context": {
    "product": {
      "id": "menu_burger_001",
      "code": "MENU-BURGER-001",
      "name": "Kids Burger",
      "menuSection": "Burgers",
      "shortDescription": "Soft bun with chicken cutlet",
      "description": "Menu-facing product description",
      "ingredients": "bun, chicken, cheese, sauce",
      "techCard": "Internal kitchen notes for generation context",
      "weightValue": "220 g",
      "servingUnit": "portion",
      "price": 260,
      "allergens": [],
      "currentImageUrl": "/uploads/catalog-images/items/current.png",
      "draftImageUrl": null
    },
    "imageRules": {
      "targetUsage": "booking_menu_catalog",
      "defaultSize": "1536x1024",
      "allowedSizes": ["1536x1024", "1024x1024", "1024x1536"],
      "defaultStyle": "catalog",
      "allowedStyles": ["catalog", "realistic", "clean-dark"],
      "styleRules": "Clean commercial menu catalog photo...",
      "backgroundRules": "Use a clean CRM-friendly food photography background...",
      "negativePrompt": "No text, letters, logo, watermark..."
    }
  },
  "meta": {
    "businessScope": {
      "mode": "single",
      "activeContext": "event_genix",
      "selectedContexts": ["event_genix"],
      "readOnly": false,
      "canWrite": true
    },
    "targetUsage": "booking_menu_catalog"
  }
}
```

### Create External Draft

```http
POST /api/hermes/menu-photos/:productId/external-draft
Content-Type: application/json
Idempotency-Key: menu-photo-menu-burger-001-20260702-001
X-Hermes-User-Confirmed: true
X-Integration-Id: hermes-event-genix-crm
```

Payload:

```json
{
  "businessContext": "event_genix",
  "imageUrl": "https://cdn.example.test/menu-images/menu-burger-001.png",
  "prompt": "Clean commercial menu catalog photo of a kids burger...",
  "provider": "hermes",
  "model": "hermes-image-model",
  "size": "1536x1024",
  "style": "catalog",
  "source": "hermes"
}
```

Successful response shape:

```json
{
  "success": true,
  "product": {
    "id": "menu_burger_001",
    "code": "MENU-BURGER-001",
    "name": "Kids Burger",
    "businessContext": "event_genix",
    "currentImageUrl": "/uploads/catalog-images/items/current.png",
    "draft": {
      "status": "ready",
      "imageUrl": "/uploads/catalog-images/items/menu-menu-burger-001-1782994000000.png",
      "prompt": "Clean commercial menu catalog photo of a kids burger...",
      "provider": "hermes",
      "model": "hermes-image-model",
      "size": "1536x1024",
      "style": "catalog",
      "generatedAt": "2026-07-02T09:00:00.000Z",
      "approvedAt": null,
      "approvedBy": null,
      "appliedAt": null,
      "appliedBy": null,
      "rejectedAt": null,
      "rejectedBy": null,
      "previousImageUrl": "/uploads/catalog-images/items/current.png",
      "error": null
    },
    "crm_url": "https://crm.example.test/programs.html#kitchen-menu:menu_burger_001"
  },
  "meta": {
    "businessScope": {
      "mode": "single",
      "activeContext": "event_genix",
      "selectedContexts": ["event_genix"],
      "readOnly": false,
      "canWrite": true
    },
    "sourceSurface": "hermes",
    "source": "hermes-event-genix-crm",
    "idempotencyKey": "menu-photo-menu-burger-001-20260702-001",
    "status": "ready",
    "provider": "hermes",
    "model": "hermes-image-model"
  }
}
```

## Apply And Reject

Apply and reject are explicit review actions. They are separate from external draft creation.

### Product API

```http
POST /api/products/:id/menu-image/apply
Content-Type: application/json
```

```json
{
  "businessContext": "event_genix"
}
```

```http
POST /api/products/:id/menu-image/reject
Content-Type: application/json
```

```json
{
  "businessContext": "event_genix",
  "reason": "Wrong composition"
}
```

### Hermes API

```http
POST /api/hermes/menu-photos/:productId/apply
Content-Type: application/json
Idempotency-Key: menu-photo-menu-burger-001-apply-20260702-001
X-Hermes-User-Confirmed: true
X-Integration-Id: hermes-event-genix-crm
```

```json
{}
```

```http
POST /api/hermes/menu-photos/:productId/reject
Content-Type: application/json
Idempotency-Key: menu-photo-menu-burger-001-reject-20260702-001
X-Hermes-User-Confirmed: true
X-Integration-Id: hermes-event-genix-crm
```

```json
{
  "reason": "Wrong composition"
}
```

Apply success means the active product image is updated and booking/menu UI will
use the new `/uploads/catalog-images/items/...` URL via `iconUrl`/`icon_url`.
The old static manifest must not be used as a fallback if the applied URL later
fails to load; the UI should show the emoji/missing-image state.

Reject success means the active product image remains unchanged and the draft is marked `rejected`.

## Hermes End-To-End Workflow

1. Fetch context with `GET /api/hermes/menu-photos/:productId/context`.
2. Confirm `meta.businessScope.canWrite` is `true` before planning a write.
3. Build the generation prompt from `context.product` and `context.imageRules`.
4. Use `context.imageRules.defaultSize` unless a human explicitly selected another allowed size.
5. Include `styleRules`, `backgroundRules`, and `negativePrompt` in the generation instruction.
6. Generate the image outside CRM.
7. Submit the final image through `POST /api/hermes/menu-photos/:productId/external-draft`.
8. Verify response `product.draft.status === "ready"` and `product.currentImageUrl` did not change.
9. Stop and report that the draft is ready for human review.
10. Apply only after a separate explicit user/operator instruction to apply this exact draft.

Default stop after step 9. Do not auto-apply.

## Manual Operator Workflow

1. Open `/programs.html#kitchen-menu`.
2. Open the target kitchen menu product.
3. In the image studio, select size/style if needed.
4. Use either file upload or pasted image URL. Do not provide both.
5. Click the manual draft action.
6. Review the draft preview.
7. Click Apply to activate it, or Reject to keep the current active image.

Manual file upload accepts PNG, JPG/JPEG, and WebP. The current client/server production MVP limit is 12 MB.

## Validation Rules

External image ingestion currently enforces:

- exactly one image source: `imageUrl` or `imageBase64`;
- `imageUrl` must be `http://` or `https://`;
- `data:image/...` belongs in `imageBase64`, not `imageUrl`;
- URL length max: 2048 characters;
- supported image MIME types: `image/png`, `image/jpeg`, `image/jpg`, `image/webp`;
- supported URL file extensions when present: `jpg`, `jpeg`, `png`, `webp`;
- base64 payload max is derived from the 12 MB binary image limit;
- private/local URL hosts are blocked for production ingestion;
- redirects are revalidated before download;
- unsupported response MIME types or oversized downloads are rejected;
- raw base64 is not returned in controlled error responses.

## Stop Conditions

Stop and do not create a draft when:

- context endpoint returns `401`, `403`, or `404`;
- product is not a kitchen menu item;
- `meta.businessScope.readOnly` is `true` or `canWrite` is `false`;
- image requirements are ambiguous enough that the generated image may misrepresent the menu item;
- the generated image includes text, logo, watermark, people, hands, packaging, distorted food, or a cropped main dish;
- no image source is available;
- both `imageUrl` and `imageBase64` are present;
- the image is not PNG, JPG/JPEG, or WebP;
- file/image size exceeds 12 MB;
- the image URL is localhost/private/internal, non-http(s), too long, or has an unsupported explicit extension;
- external-draft returns any non-2xx response.

Stop and do not apply when:

- draft status is not `ready`;
- the returned draft image URL is empty;
- `product.currentImageUrl` changed during draft creation;
- the operator did not explicitly confirm applying this exact draft;
- Hermes is in `businessScope=all` or any read-only scope;
- an idempotency retry would require changing the request body.

## Troubleshooting

Auth and environment errors:

| Code | Meaning | Action |
| --- | --- | --- |
| `HERMES_AUTH_NOT_CONFIGURED` | CRM server does not have `HERMES_API_KEY`. | Configure `HERMES_API_KEY` in the CRM server environment, restart the server, then retry a read endpoint. |
| `HERMES_ACTOR_NOT_CONFIGURED` | CRM server does not have a valid `HERMES_ACTOR_USER_ID`. | Configure `HERMES_ACTOR_USER_ID` to an active CRM user id that can access the target business context. |
| `HERMES_ACTOR_NOT_FOUND` | `HERMES_ACTOR_USER_ID` does not match a user row. | Point `HERMES_ACTOR_USER_ID` to an existing active CRM user. |
| `HERMES_ACTOR_INACTIVE` | Hermes actor user exists but is inactive. | Use an active CRM user for `HERMES_ACTOR_USER_ID` or reactivate the intended actor through normal CRM user management. |
| `HERMES_AUTH_REQUIRED` | Client/agent did not send `x-api-key` or bearer credentials. | Add `x-api-key: ***` or `Authorization: Bearer ***`. If the runtime only has `EVENT_GENIX_CRM_API_KEY`, explicitly map it to `x-api-key`. |
| `HERMES_AUTH_INVALID` | Client/agent sent a key that does not match CRM `HERMES_API_KEY`. | Use the same secret configured on the CRM server; do not log or paste the value into task notes. |
| `HERMES_BUSINESS_CONTEXT_FORBIDDEN` | Actor context was narrowed by `HERMES_ALLOWED_BUSINESS_CONTEXTS` and no allowed actor context remains. | Include `event_genix` in the allowlist or choose an actor whose business contexts overlap the allowlist. |
| `business_context_unavailable` | Actor cannot access requested `businessContext`, or the request selected an unavailable scope. | Use `businessContext=event_genix` with an actor that has access to `event_genix`. |
| `business_scope_read_only` | Hermes attempted a write in `all` or multi-business scope. | Use a single writable business context before creating drafts, applying, or rejecting. |

Common external-draft errors:

| Code | Meaning | Action |
| --- | --- | --- |
| `menu_image_source_required` | Missing `imageUrl` and `imageBase64`. | Provide exactly one source. |
| `menu_image_source_conflict` | Both sources were provided. | Remove one source. |
| `menu_image_source_invalid` | Invalid protocol, MIME, base64, or extension. | Use http(s) URL or valid image data URL in `imageBase64`. |
| `menu_image_source_forbidden` | URL host is blocked. | Use a public image URL or submit base64. |
| `menu_image_source_too_large` | Base64/image payload is too large. | Resize/compress below 12 MB. |
| `menu_image_url_too_long` | URL exceeds 2048 characters. | Use a shorter URL or base64. |
| `menu_image_payload_unsupported_field` | Payload contains a field outside the contract. | Send only documented fields. |
| `menu_image_upload_failed` | CRM could not save the image. | Check source availability, MIME, size, and CRM uploads. |
| `IDEMPOTENCY_KEY_REQUIRED` | Hermes mutation header missing. | Add `Idempotency-Key`. |
| `HERMES_CONFIRMATION_REQUIRED` | Hermes confirmation header missing. | Add `X-Hermes-User-Confirmed: true`. |

## Verification Commands

Use Node 22/npm 10:

```bash
npx -y -p node@22 -p npm@10 -c "npm run check:runtime"
npx -y -p node@22 -p npm@10 -c "node --test tests/menu-image-drafts.test.js tests/image-storage.test.js tests/hermes-routes.test.js tests/products-detailed-tech-card.test.js tests/products-ia.test.js"
npx -y -p node@22 -p npm@10 -c "node --test tests/booking-package-contract.test.js tests/booking-drawer-encoding.test.js"
npx -y -p node@22 -p npm@10 -c "npm run test:ui"
npx -y -p node@22 -p npm@10 -c "npm run check:syntax"
```

Broader local baseline:

```bash
npx -y -p node@22 -p npm@10 -c "npm test"
```

## Manual QA Checklist

1. Fetch Hermes context for one active kitchen menu product.
2. Submit a valid `imageUrl` external draft.
3. Confirm CRM response status is `ready`.
4. Confirm product active image did not change before apply.
5. Reject the draft and confirm active image did not change.
6. Submit a file/base64 draft.
7. Apply the draft.
8. Open booking menu and confirm the applied `/uploads/catalog-images/items/...` image appears through `iconUrl`/`icon_url`.
9. Break or remove the image URL in a test environment and confirm the UI shows the emoji/missing-image state, not a static manifest photo.
