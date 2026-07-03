# Kitchen Menu Image Assets

The booking menu catalog uses real product photos from the product API. Static
manifest images remain only as legacy/static compatibility data and are not the
source of truth for new Hermes or manual menu photos.

## Source Priority

Booking menu cards resolve new menu photos through one active path:

```text
products.icon_url -> /api/products iconUrl/icon_url -> UI image
```

If `iconUrl`/`icon_url` is missing or the referenced image fails to load, the UI
must show its emoji/missing-image state. It must not silently replace a broken
Hermes/generated upload with an old static manifest image.

Generated menu photos are not applied automatically. Product admins or Hermes
first create a draft under `products.ai_card_draft.imageStudio`; only an
explicit `apply` action copies the approved draft URL into `products.icon_url`.
The generated image files are stored through `services/imageStorage.js` under
`/uploads/catalog-images/items`.

Default Hermes/menu-photo size is `1536x1024` (`3:2`). This is the preferred
format for booking menu cards. Other supported sizes are exceptions selected
explicitly during generation.

## Workflow

1. Generate or download images for menu/cake products.
2. Save them in `images/kitchen-menu/`.
3. Name files by product code:
   - `MENU-026` -> `products/menu-026.webp`
   - `CAKE-06` -> `products/cake-06.webp`
4. Run:

```bash
node scripts/sync-kitchen-menu-images.js
```

5. Reload the CRM only for legacy/static surfaces that still read the manifest.
   New Hermes/manual photos still require an explicit draft/apply flow that
   writes `products.icon_url`.

## Filename Rules

The sync script matches these forms:
- product code slug: `products/menu-026.webp`, `products/cake-06.png`
- product code slug at the folder root: `menu-026.webp`, `cake-06.png`
- product id slug: `menu-2026-026-item.webp`, `cake-snikers.jpg`
- generated human names with numeric prefixes: `001_Бургер з біфштексом.jpg`
- nested section folders such as `01_Бургери/001_Бургер з біфштексом.jpg`

Preferred format is `.webp`; `.png`, `.jpg`, `.jpeg`, and `.avif` are also
accepted.

Current imported batch files are kept in `images/kitchen-menu/products/` with
ASCII product-code filenames so browser URLs and deployment artifacts do not
depend on ZIP filename encoding.
The batch does not include separate images for pizza add-ons, first courses,
`Склянка молока`, or `Молоко — додаток до кави`; those products keep emoji
fallbacks until images are added.

Do not use `images/kitchen-menu/products/menu-031.jpg` as the correct
Margherita photo. `MENU-031` / `menu_2026_031_item` should receive its current
photo only through `products.icon_url` after the draft/apply workflow.

## Notes

- Do not use remote hotlinked images in production; download and keep local
  optimized assets.
- For Hermes/menu-photo work, use `1536x1024` unless a human selects another
  allowed size.
- The static manifest must not override or replace an applied product photo from
  `products.icon_url`.
- AI/Hermes generated drafts use a card-friendly horizontal prompt and may
  store source files in `/uploads/catalog-images/items`; the card UI is sized
  for the `3:2` generated-photo format.
