# TASK: Hermes Menu Photo Contract

- Status: proposed after analysis
- Type: implementation task
- Production impact: yes

## Goal

Extend the Hermes CRM integration with safe menu photo actions that reuse the
existing Hermes authentication, confirmation, business context, and idempotency
rails.

## Recommended Scope

- Extend `SUPPORTED_ACTIONS` in `routes/hermes.js` with:
  - `menu_photos.read`;
  - `menu_photos.candidates`;
  - `menu_photos.draft`;
  - `menu_photos.apply`;
  - `menu_photos.reject`.
- Add Hermes endpoints after the product draft API exists:
  - `GET /api/hermes/menu-photos/candidates`;
  - `GET /api/hermes/menu-photos/:productId`;
  - `POST /api/hermes/menu-photos/:productId/draft`;
  - `POST /api/hermes/menu-photos/:productId/apply`;
  - `POST /api/hermes/menu-photos/:productId/reject`.
- Use existing Hermes middleware:
  - `hermesAuth`;
  - `requireHermesMutationGuard`;
  - `withHermesIdempotency`.
- Mutations must require:
  - `X-Hermes-User-Confirmed: true`;
  - `Idempotency-Key`;
  - writable single business context.
- Return only safe data: product id/code/name, current image, draft status,
  draft image URL, prompt snapshot, provider/model labels, timestamps, and CRM
  URL.
- Do not expose provider keys, raw headers, cookies, or full request bodies.

## Non-Goals

- Do not let Hermes perform unconfirmed bulk generation.
- Do not add a Hermes callback/webhook.
- Do not bypass normal product permissions or business context rules.
- Do not create a Hermes actor user automatically.

## Acceptance Criteria

- `/api/hermes/capabilities` advertises menu photo capabilities.
- Hermes draft/apply/reject mutations are idempotent.
- Hidden or inaccessible products return 404/403 without leaking extra data.
- Draft generation does not change `products.icon_url`.
- Apply changes `products.icon_url` only for a ready draft.

## Documentation Updates

- `docs/HERMES_INTEGRATION.md`
- `docs/API_SURFACE.md`
- `docs/AUTH_BOUNDARY.md` only if the auth boundary changes.

## Suggested Test Updates

- `tests/hermes-routes.test.js`
- `tests/hermes-auth.test.js`
- `tests/hermes-idempotency.test.js`
- `tests/hermes-audit.test.js`

## Verification

```bash
npm run check:runtime
node --test tests/hermes-routes.test.js
node --test tests/hermes-auth.test.js
node --test tests/hermes-idempotency.test.js
npm run check:auth-boundary
npm run check:api-surface
```

