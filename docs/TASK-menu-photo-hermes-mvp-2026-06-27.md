# TASK PACK: Hermes Menu/Product Photo Generation MVP

- Status: proposed after analysis
- Type: implementation task pack
- Production impact: yes

## Goal

Introduce a safe MVP workflow where Hermes and CRM operators can generate menu
or product photos as drafts, preview them, and apply them only after explicit
approval.

## Problem Summary

Kitchen menu photos currently come from two surfaces:

- static manifest assets in `images/kitchen-menu/` via `js/kitchen-menu-images.js`;
- generated product assets persisted to `products.icon_url` through
  `POST /api/products/:id/menu-image/generate`.

The booking menu catalog currently checks `imageUrl`, `photoUrl`, `coverUrl`,
`thumbnailUrl`, then the static manifest. It does not use `iconUrl`, so a
generated product photo can be saved in the product card but not appear in the
booking menu catalog. The existing generation endpoint also applies the image
immediately instead of storing it as a human-reviewable draft.

## Recommended Implementation Order

1. `TASK-menu-photo-source-unification-2026-06-27.md`
2. `TASK-menu-photo-draft-api-2026-06-27.md`
3. `TASK-menu-photo-admin-ui-2026-06-27.md`
4. `TASK-hermes-menu-photo-contract-2026-06-27.md`
5. `TASK-menu-photo-verification-docs-2026-06-27.md`
6. `TASK-menu-photo-bulk-queue-phase2-2026-06-27.md` after the single-item MVP is stable

## MVP Architecture

- Keep `products.icon_url` as the applied/current photo.
- Store generated drafts in `products.ai_card_draft.imageStudio`.
- Use `/uploads/catalog-images/items` through `services/imageStorage.js`.
- Add a shared menu photo prompt template under `product_ai_settings` only if
  it can be done without a schema change; otherwise keep the template in a
  product-owned backend service for MVP.
- Do not let Hermes directly overwrite `icon_url`; Hermes should generate a
  draft first, then apply only through a confirmed/idempotent mutation.

## MVP Status Model

Use these image draft statuses in `imageStudio.status`:

- `draft`
- `generating`
- `ready`
- `failed`
- `approved`
- `rejected`
- `applied`

If a stricter DB constraint is needed later, propose a governed migration first.

## Shared Prompt Template

```text
Create one product catalog photo for a Ukrainian children entertainment center CRM.

Menu item: {{name}}
CRM code: {{code}}
Type: {{kitchenType}}
Menu section: {{menuSection}}
Serving unit: {{servingUnit}}
Weight/output: {{weightValue}}
Ingredients: {{ingredients}}
Description: {{description}}

Style:
Clean commercial restaurant menu photo, appetizing but realistic, centered dish, useful at small card size.

Composition:
Horizontal CRM menu card crop, dish fully visible, no text, no logo, no watermark, no people, no hands, no packaging.

Safety:
Do not invent labels or decorations. If details are unknown, keep presentation generic and realistic.
```

## Non-Goals

- Do not implement category-wide bulk generation in the MVP.
- Do not introduce new storage providers or production env vars in the MVP.
- Do not add a schema migration without explicit approval.
- Do not delete or rewrite existing static kitchen menu images.
- Do not deploy or configure production secrets.

## Acceptance Criteria

- Booking menu cards can display generated product photos from the product API.
- Generating a photo creates a draft and does not immediately replace the
  current applied photo.
- Applying a draft is a separate explicit action.
- Existing static manifest images continue to work as fallback.
- Hermes mutations require the existing Hermes auth, confirmation, and
  idempotency rails.

## Verification

```bash
npm run check:runtime
node --test tests/products-ia.test.js
node --test tests/products-detailed-tech-card.test.js
node --test tests/booking-package-contract.test.js
node --test tests/hermes-routes.test.js
npm run test:ui
```

