# Menu Image Agent Workflow Audit

Date: 2026-07-02
Branch: `codex/timeline-leads-hardening`
Package version observed: `0.77.95`
Scope: audit-only, no behavior/schema/env/deploy changes.

Post-audit note: implementation work after this audit added the Product/Hermes context and external-draft workflow. Use `docs/MENU_IMAGE_AGENT_WORKFLOW.md` as the current operational contract. Sections below that describe missing routes or proposed follow-ups are historical audit findings, not the current implementation state.

## Executive Summary

The CRM already has most of the menu-photo draft pipeline:

- active menu/product image is stored on `products.icon_url` and exposed to the frontend as `iconUrl`;
- generated/reviewable image state is stored under `products.ai_card_draft.imageStudio`;
- product UI and booking menu catalog already prefer explicit product image URLs before the static `js/kitchen-menu-images.js` manifest;
- product API already supports generate, status, apply, and reject for menu image drafts;
- Hermes already has menu photo routes, but they are not the requested external-file contract. The current Hermes draft route triggers CRM-side OpenAI generation and accepts only `size`/`style`.

Main gap: Hermes cannot yet submit a generated file/URL/base64 as a reviewable CRM draft. Manual operator upload/paste is also not implemented as a first-class draft workflow.

Production impact: yes.

## Guardrails Followed

- No database schema or migration changes.
- No env/secrets changes.
- No deploy or infrastructure changes.
- No fallback assets deleted or modified.
- Only this audit document was added.

## Files Reviewed

- `routes/products.js`
- `routes/hermes.js`
- `services/menuPhotoGeneration.js`
- `services/imageStorage.js`
- `js/programs-page.js`
- `js/api.js`
- `js/booking.js`
- `js/kitchen-menu-images.js`
- `db/migrations/225_products_menu_ai_card_workflow.sql`
- `db/migrations/240_products_program_icon_generation.sql`
- `tests/products-ia.test.js`
- `tests/products-detailed-tech-card.test.js`
- `tests/booking-package-contract.test.js`
- `tests/booking-drawer-encoding.test.js`
- `tests/hermes-routes.test.js`
- `tests/image-storage.test.js`
- `tests/ui-check.js`
- `docs/AI_PROVIDER_CONTRACT.md`

## Current Image Source Flow

### Booking banquet menu/catalog

`js/booking.js` resolves the visible menu catalog image in this order:

1. `product.imageUrl`
2. `product.image_url`
3. `product.photoUrl`
4. `product.photo_url`
5. `product.coverUrl`
6. `product.cover_url`
7. `product.thumbnailUrl`
8. `product.thumbnail_url`
9. `product.iconUrl`
10. `product.icon_url`
11. `window.KITCHEN_MENU_IMAGES` manifest by product id/code/name
12. `/images/kitchen-menu/fallback-burger-wide.jpg`

Evidence:

- `js/booking.js`: `bookingMenuProductImageUrl()` builds explicit URL first, then calls `bookingMenuImageManifestUrl()`.
- `js/booking.js`: `BOOKING_MENU_CATALOG_FALLBACK_IMAGE = '/images/kitchen-menu/fallback-burger-wide.jpg'`.
- `tests/booking-package-contract.test.js`: asserts generated `/uploads/catalog-images/items/menu-juice-generated.png` is used before `/images/kitchen-menu/juice.webp`.

Conclusion: yes, `products.icon_url` has priority over `js/kitchen-menu-images.js` after backend mapping to `iconUrl`.

### Products kitchen menu page

`js/programs-page.js` uses the same pattern:

1. explicit product image fields, including `iconUrl` / `icon_url`;
2. `window.KITCHEN_MENU_IMAGES`;
3. `/images/kitchen-menu/fallback-burger-wide.jpg`.

The current product card and the "Фото меню" panel therefore already show an applied `products.icon_url` image before static manifest fallback.

## Current Draft State

Menu image draft state lives inside:

```text
products.ai_card_draft.imageStudio
```

Normalized fields include:

- `version`
- `status`: `draft`, `generating`, `ready`, `failed`, `approved`, `rejected`, `applied`
- `source`
- `imageUrl`
- `prompt`
- `provider`
- `model`
- `size`
- `style`
- `preparedAt`
- `generatedAt`
- `approvedAt`
- `approvedBy`
- `appliedAt`
- `appliedBy`
- `rejectedAt`
- `rejectedBy`
- `previousImageUrl`
- `storage`
- `error`

Evidence:

- `routes/products.js`: `normalizeMenuImageStudio()` and `normalizeMenuAiDraft()`.
- `routes/hermes.js`: `normalizeHermesMenuImageStudio()` and `buildHermesMenuPhotoDraft()`.
- `db/migrations/225_products_menu_ai_card_workflow.sql`: adds `products.ai_card_draft`.

## Product API: Existing Menu Image Endpoints

Existing routes in `routes/products.js`:

- `POST /api/products/:id/menu-image/draft`
- `POST /api/products/:id/menu-image/generate`
- `GET /api/products/:id/menu-image/status`
- `POST /api/products/:id/menu-image/apply`
- `POST /api/products/:id/menu-image/reject`

Current behavior:

- `draft` / `generate` creates a reviewable draft through CRM-side OpenAI image generation.
- Draft generation writes `products.ai_card_draft`, not `products.icon_url`.
- `apply` copies the ready draft image URL into `products.icon_url` and marks draft `applied`.
- `reject` updates draft status and keeps `products.icon_url` unchanged.
- Routes are protected by `requireRole(...PRODUCT_MUTATION_ROLES)` and product business context checks.

Missing product API routes for the requested contract:

- `GET /api/products/:id/menu-image/context`
- `POST /api/products/:id/menu-image/external-draft`

## Hermes API: Existing Menu Photo Routes

Existing routes in `routes/hermes.js`:

- `GET /api/hermes/menu-photos/candidates`
- `GET /api/hermes/menu-photos/:productId`
- `POST /api/hermes/menu-photos/:productId/draft`
- `POST /api/hermes/menu-photos/:productId/apply`
- `POST /api/hermes/menu-photos/:productId/reject`

Current Hermes draft behavior:

- accepts only `settings`, `size`, and `style`;
- builds prompt from CRM product data;
- triggers CRM-side OpenAI image generation;
- stores generated image in CRM uploads through `services/imageStorage.js`;
- writes draft to `products.ai_card_draft.imageStudio`;
- does not apply automatically.

Important limitation:

The current Hermes routes do not let Hermes submit a generated `imageUrl` or `imageBase64`. They also do not return full generation context: the safe detail response currently returns only `id`, `code`, `name`, `businessContext`, `currentImageUrl`, `draft`, and `crm_url`.

Mutation guard expectation:

- Hermes write routes use confirmed/idempotent mutations in tests.
- Future external draft route should require `Idempotency-Key` and `X-Hermes-User-Confirmed: true`, matching existing Hermes mutation behavior.

## Manual UI State

Existing UI in `/programs#kitchen-menu`:

- shows current image and AI draft preview;
- lets an operator select size/style;
- lets an operator generate a CRM-side AI draft;
- lets an operator apply or reject a draft.

Missing manual workflow:

- no file upload control for manual photo replacement;
- no paste-URL-as-draft control;
- no manual `imageBase64`/`imageUrl` draft API helper in `js/api.js`;
- no manual draft endpoint in `routes/products.js`.

Minimal UI needed:

1. In `renderKitchenMenuImageStudio()`, add "Upload file" and "Paste image URL" controls.
2. In `js/api.js`, add helper for `POST /api/products/:id/menu-image/external-draft`.
3. Store manual image as draft with `source: 'manual'`, not as immediate `products.icon_url`.
4. Reuse existing Apply/Reject buttons.

## Storage Flow

Generated image persistence uses `services/imageStorage.js`:

- local base dir: `uploads/catalog-images`;
- public prefix: `/uploads/catalog-images`;
- default item dir: `uploads/catalog-images/items`;
- public item URL format: `/uploads/catalog-images/items/<filename>`;
- supports remote `http(s)` URLs and `data:image/...;base64,...`;
- sanitizes filenames to `.jpg`, `.jpeg`, `.png`, or `.webp`.

`services/menuPhotoGeneration.js` calls `uploadFromUrl()` and uses `makeFilename('menu', label, 'png')`.

Tests confirm:

- `tests/image-storage.test.js` verifies storage under `/uploads/catalog-images/items`.

## Env Needed For Existing CRM-Side Generation

Do not print or commit secret values.

Existing CRM-side menu image generation uses:

- `OPENAI_API_KEY`
- `OPENAI_API_BASE` optional, defaults to `https://api.openai.com/v1`
- `OPENAI_MENU_IMAGE_MODEL` optional
- `OPENAI_IMAGE_MODEL` optional fallback

Existing text review draft uses:

- `OPENAI_API_KEY`
- `OPENAI_API_BASE` optional
- `OPENAI_MENU_AI_MODEL` optional

If Hermes generates images externally and only posts the final asset to CRM, the `external-draft` path should not require `OPENAI_API_KEY`. It should only validate and persist the submitted image.

## Static Manifest Risk

Risk level: low for already-applied product images, medium for operator confusion.

Why low:

- Both booking and products UI prefer explicit product image fields before the manifest.
- Tests assert generated/uploaded URLs win over manifest fallback.

Why medium:

- `js/kitchen-menu-images.js` is still loaded and still contains many static mappings.
- If `icon_url` is empty, broken, not returned by an API response, or filtered out by a future mapping change, the static manifest silently takes over.
- Operators may see a fallback/legacy image and assume the generated draft was applied when it was only stored as a draft.

Recommended follow-up:

- Add explicit tests for `products.icon_url` priority in both `js/booking.js` and `js/programs-page.js`.
- In UI, label current image source clearly: `iconUrl`, `manifest fallback`, or `generic fallback`.

## Proposed Hermes/Product Contract

This is a design target, not implemented in this audit.

### `GET /api/products/:id/menu-image/context`

Purpose: give Hermes all product facts and CRM style rules needed to generate an image outside CRM.

Response shape:

```json
{
  "success": true,
  "product": {
    "id": "menu_2026_001_item",
    "code": "MENU-001",
    "name": "Burger",
    "menuSection": "Burgers",
    "shortDescription": "...",
    "description": "...",
    "ingredients": "...",
    "techCard": "...",
    "weightValue": "250 g",
    "servingUnit": "portion",
    "price": 260,
    "allergens": [],
    "currentImageUrl": "/uploads/catalog-images/items/current.png",
    "draftImageUrl": "/uploads/catalog-images/items/draft.png"
  },
  "imageRules": {
    "targetUsage": "booking_menu_catalog",
    "defaultSize": "1536x1024",
    "allowedSizes": ["1536x1024", "1024x1024", "1024x1536"],
    "styleRules": "Clean commercial menu catalog photo...",
    "backgroundRules": "CRM-friendly background...",
    "negativePrompt": "No text, logo, watermark, people, hands, packaging..."
  }
}
```

Implementation notes:

- Should require existing product read access and business context.
- Should only expose generation-safe product facts.
- Should not expose raw internal notes beyond fields already intended for product/menu content.
- Can initially source rules from code constants, then later from `product_ai_settings`.

### `POST /api/products/:id/menu-image/external-draft`

Purpose: let Hermes or a human submit a generated image as a reviewable draft without changing the active menu photo.

Accepted body:

```json
{
  "businessContext": "event_genix",
  "imageUrl": "https://...",
  "imageBase64": null,
  "prompt": "Final prompt used by Hermes",
  "provider": "hermes",
  "model": "external-model-name",
  "size": "1536x1024",
  "style": "catalog",
  "source": "hermes"
}
```

Rules:

- Require exactly one of `imageUrl` or `imageBase64`.
- Convert `imageBase64` to a `data:image/...;base64,...` source internally and use `uploadFromUrl()`.
- Save the file under `/uploads/catalog-images/items`.
- Write only `products.ai_card_draft.imageStudio`.
- Do not update `products.icon_url`.
- Set draft status to `ready`.
- Store `previousImageUrl` from current `products.icon_url`.
- Reuse existing `apply` endpoint to activate.
- For Hermes write access, mirror existing mutation guard behavior: idempotency key and explicit confirmation header.

Suggested normalized draft:

```json
{
  "version": 1,
  "status": "ready",
  "source": "hermes",
  "imageUrl": "/uploads/catalog-images/items/menu-burger-123.png",
  "prompt": "Final prompt used by Hermes",
  "provider": "hermes",
  "model": "external-model-name",
  "size": "1536x1024",
  "style": "catalog",
  "generatedAt": "2026-07-02T00:00:00.000Z",
  "previousImageUrl": "/uploads/catalog-images/items/current.png",
  "storage": {
    "provider": "local",
    "publicUrl": "/uploads/catalog-images/items/menu-burger-123.png"
  },
  "error": null
}
```

### Alternative Hermes-native route

Because Hermes already uses `/api/hermes/menu-photos/...`, a more consistent agent-facing contract may be:

- `GET /api/hermes/menu-photos/:productId/context`
- `POST /api/hermes/menu-photos/:productId/external-draft`

Recommendation:

- Implement product routes as canonical shared logic.
- Optionally expose Hermes wrappers that call the same service functions and keep Hermes auth/idempotency semantics.

## Tests To Add Or Update

Product API tests:

- `external-draft` rejects missing image.
- `external-draft` rejects both `imageUrl` and `imageBase64` together.
- `external-draft` persists image into `/uploads/catalog-images/items`.
- `external-draft` writes `products.ai_card_draft.imageStudio`.
- `external-draft` does not write `products.icon_url`.
- `apply` activates external draft exactly like CRM-generated draft.

Hermes route tests:

- context route returns safe product facts and image rules.
- external draft route requires confirmation/idempotency.
- external draft route rejects unsupported fields.
- external draft route rejects read-only `businessScope=all`.
- external draft route does not leak hidden/inaccessible products.

Frontend/UI tests:

- manual URL draft helper exists in `js/api.js`.
- manual upload/paste controls exist in `js/programs-page.js`.
- Apply/Reject are reused after manual draft creation.
- `products.icon_url` remains preferred over manifest in booking and product UI.

Existing tests already covering current behavior:

- `tests/products-ia.test.js`
- `tests/products-detailed-tech-card.test.js`
- `tests/booking-package-contract.test.js`
- `tests/booking-drawer-encoding.test.js`
- `tests/hermes-routes.test.js`
- `tests/image-storage.test.js`
- `tests/ui-check.js`

## Missing Decisions Before Implementation

1. Should Hermes call product routes directly, or should it only use `/api/hermes/menu-photos/...` wrappers?
2. Should auto-apply ever be allowed? Recommended default: no. Require explicit task instruction.
3. What exact corporate style/background rules should be stored as defaults?
4. Should context expose `techCard` fully, or only product-facing dish description/ingredients?
5. What input should Hermes prefer: public `imageUrl`, `imageBase64`, or writing to a local upload path?
6. What maximum image size and allowed MIME types should be enforced?
7. Should manual operator upload share the same endpoint or have a separate UI-only route?

## Stop Conditions For The Implementation Agent

Stop and request explicit confirmation before:

- adding or changing DB schema/migrations;
- changing auth, roles, permissions, sessions, or Hermes authentication;
- changing env vars/secrets;
- changing Railway/Vercel/deploy/CI;
- adding dependencies;
- enabling automatic apply in production;
- mass-generating images for all menu positions;
- deleting or replacing `js/kitchen-menu-images.js` or static fallback assets;
- writing generated images outside `/uploads/catalog-images/items`.

## Verification Log

Raw audit commands:

```bash
git status --short --branch
```

Result:

- Passed.
- Output: `## codex/timeline-leads-hardening...origin/codex/timeline-leads-hardening`

```bash
npm run check:runtime
```

Result:

- Failed in the host shell.
- Error: Node `24.13.0` and npm `11.6.2` detected, expected Node `22.x` and npm `10.x`.
- This blocks trusting direct host-shell verification.
- Representative rerun used pinned runtime:

```bash
npx -y -p node@22 -p npm@10 -c "npm run check:runtime"
```

Result:

- Passed.
- Runtime baseline: Node `22.23.1` / npm `10.9.8`.

Focused test command requested by the task was run through pinned Node 22/npm 10 because the direct host shell is on the wrong runtime:

```bash
npx -y -p node@22 -p npm@10 -c "node --test tests/products-ia.test.js tests/products-detailed-tech-card.test.js tests/booking-package-contract.test.js tests/hermes-routes.test.js tests/image-storage.test.js"
```

Result:

- Passed.
- `126` pass, `0` fail.

UI check command requested by the task was run through pinned Node 22/npm 10:

```bash
npx -y -p node@22 -p npm@10 -c "npm run test:ui"
```

Result:

- Passed.
- `1127` pass, `0` fail.

## Recommended Next Task

Implement the contract in two thin layers:

1. Shared product-owned service for:
   - building menu image context;
   - accepting external draft asset;
   - saving through `uploadFromUrl()`;
   - writing `products.ai_card_draft.imageStudio` only.
2. Route wrappers:
   - product API route for CRM/manual UI;
   - Hermes route preserving Hermes auth, business scope, confirmation, and idempotency.

Keep `apply` as the only path that changes `products.icon_url`.
