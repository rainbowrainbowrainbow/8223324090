# TASK: Menu Photo Draft API

- Status: proposed after analysis
- Type: implementation task
- Production impact: yes

## Goal

Replace immediate menu image application with a safe draft, preview, apply, and
reject API workflow.

## Recommended Scope

- Extract menu photo generation logic from `routes/products.js` into a small
  service, for example `services/menuPhotoGeneration.js`.
- Keep existing OpenAI image generation behavior, but make the default write a
  draft to `products.ai_card_draft.imageStudio`.
- Add or refactor product endpoints:
  - `POST /api/products/:id/menu-image/draft`;
  - `POST /api/products/:id/menu-image/apply`;
  - `POST /api/products/:id/menu-image/reject`;
  - `GET /api/products/:id/menu-image/status`.
- Keep `POST /api/products/:id/menu-image/generate` as a compatibility alias
  only if needed, but avoid immediate `icon_url` overwrite in the new MVP flow.
- Store in `imageStudio`:
  - `status`;
  - `imageUrl`;
  - `prompt`;
  - `provider`;
  - `model`;
  - `size`;
  - `style`;
  - `generatedAt`;
  - `approvedAt`;
  - `approvedBy`;
  - `appliedAt`;
  - `appliedBy`;
  - `previousImageUrl`;
  - `error`.
- Reuse `productMenuImageRateLimit`.
- Preserve business context checks and `PRODUCT_MUTATION_ROLES`.

## Non-Goals

- Do not add bulk generation.
- Do not introduce a queue in this task.
- Do not add a schema migration unless the draft JSONB approach is proven
  insufficient and explicitly approved.
- Do not expose OpenAI keys or raw provider responses to the browser.

## Acceptance Criteria

- Draft generation saves a generated image URL in `ai_card_draft.imageStudio`
  and does not change `products.icon_url`.
- Apply copies the ready draft image URL to `products.icon_url`.
- Reject marks the draft rejected and leaves `products.icon_url` unchanged.
- Failed generation records a controlled error in draft metadata.
- Missing `OPENAI_API_KEY` returns the existing controlled unavailable error
  pattern.

## Suggested Test Updates

- `tests/products-detailed-tech-card.test.js`
- `tests/products-ia.test.js`
- Add focused route/service assertions if practical without a live OpenAI call.

## Verification

```bash
npm run check:runtime
node --test tests/products-detailed-tech-card.test.js
node --test tests/products-ia.test.js
npm run check:syntax
```

