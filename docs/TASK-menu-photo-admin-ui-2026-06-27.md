# TASK: Menu Photo Admin UI

- Status: proposed after analysis
- Type: implementation task
- Production impact: yes

## Goal

Give managers/admins a clear UI for generating, previewing, applying, and
rejecting menu photo drafts without overwriting good existing photos by
accident.

## Recommended Scope

- Update the existing image studio in `js/programs-page.js`.
- Replace the current one-button generate/apply behavior with:
  - `Generate draft`;
  - `Regenerate draft`;
  - `Apply`;
  - `Reject`.
- Show current applied photo and draft photo separately.
- Show draft status and a short prompt preview.
- Preserve existing product page visual style in `css/pages-products.css`.
- Keep all user-facing labels in Ukrainian.
- Disable mutation buttons while a request is in progress.
- Keep role/business-context guards from existing product actions.

## Non-Goals

- Do not build a new standalone AI Photos page in the MVP.
- Do not add bulk category UI yet.
- Do not change product create/edit form layout beyond the image studio area.

## Acceptance Criteria

- Managers/admins can generate a draft without replacing the applied photo.
- Managers/admins can see the draft before applying it.
- Applying a draft refreshes the product card and booking catalog source.
- Rejecting a draft keeps the current applied photo.
- UI clearly communicates failed/unavailable generation without exposing
  secrets or raw provider payloads.

## Suggested Test Updates

- `tests/products-ia.test.js`
- `tests/products-detailed-tech-card.test.js`
- `tests/ui-check.js`

## Verification

```bash
npm run check:runtime
node --test tests/products-ia.test.js
node --test tests/products-detailed-tech-card.test.js
npm run test:ui
```

