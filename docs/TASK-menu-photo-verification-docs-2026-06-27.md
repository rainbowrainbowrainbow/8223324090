# TASK: Menu Photo Verification And Documentation

- Status: proposed after analysis
- Type: implementation task
- Production impact: yes

## Goal

Document and verify the menu photo MVP so future agents do not reintroduce
immediate image overwrites or source drift between products and booking menu
cards.

## Recommended Scope

- Update `docs/AI_PROVIDER_CONTRACT.md` to mention kitchen menu image drafts,
  not just AI review text drafts.
- Update `docs/kitchen-menu-images.md` to clarify source priority:
  - `products.icon_url` first;
  - static manifest second;
  - fallback image last.
- Update `docs/HERMES_INTEGRATION.md` after Hermes photo endpoints are added.
- Add/update tests for:
  - product API image draft/apply/reject ownership;
  - booking catalog using `iconUrl`;
  - image studio UI wiring;
  - Hermes capabilities and mutation safety.
- Run the smallest focused tests first, then the local baseline if the change
  touches multiple shared surfaces.

## Non-Goals

- Do not add release notes or bump version unless the implementation is being
  shipped as a user-visible release in the same change packet.
- Do not document real API keys, provider accounts, or production host details.

## Acceptance Criteria

- Docs explain where prompts live, where generated images are stored, and how
  approval works.
- Tests fail if the booking catalog stops reading product-applied images.
- Tests fail if the product endpoint goes back to unreviewed immediate apply.
- Hermes docs and capabilities stay aligned.

## Verification

```bash
npm run check:runtime
npm run check:api-surface
npm run check:auth-boundary
npm run check:storage-surface
node --test tests/products-ia.test.js
node --test tests/products-detailed-tech-card.test.js
node --test tests/booking-package-contract.test.js
node --test tests/hermes-routes.test.js
npm run test:ui
```

