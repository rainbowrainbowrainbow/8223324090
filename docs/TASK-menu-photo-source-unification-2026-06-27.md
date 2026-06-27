# TASK: Menu Photo Source Unification

- Status: proposed after analysis
- Type: implementation task
- Production impact: yes

## Goal

Make the booking menu catalog and products page use the same product photo
source order so generated photos actually appear where operators select menu
items.

## Recommended Scope

- Inspect current image source helpers before editing:
  - `bookingMenuProductImageUrl` in `js/booking.js`;
  - `productMenuImageUrl` in `js/programs-page.js`;
  - `mapProductRow` in `routes/products.js`.
- Update booking catalog image resolution to include:
  - `product.iconUrl`;
  - `product.icon_url`;
  - existing `imageUrl`, `photoUrl`, `coverUrl`, `thumbnailUrl`;
  - static manifest fallback from `window.KITCHEN_MENU_IMAGES`.
- Keep static manifest images as fallback, not as the only production source.
- Review crop behavior in `css/panel.css` and `css/pages-products.css`.
- Prefer a card-friendly prompt/aspect decision rather than patching every
  image manually.

## Non-Goals

- Do not generate new images in this task.
- Do not remove `js/kitchen-menu-images.js`.
- Do not change booking payload shape.
- Do not add a database migration.

## Acceptance Criteria

- A product returned by `/api/products` with `iconUrl` displays that image in
  the booking menu catalog.
- A product without `iconUrl` still uses the static manifest image.
- A product with neither source still falls back to the existing safe fallback.
- Existing image error fallback behavior remains intact.
- Tests cover the new source priority.

## Suggested Test Updates

- `tests/booking-package-contract.test.js`
- `tests/products-ia.test.js`
- `tests/ui-check.js`

## Verification

```bash
npm run check:runtime
node --test tests/booking-package-contract.test.js
node --test tests/products-ia.test.js
npm run test:ui
```

