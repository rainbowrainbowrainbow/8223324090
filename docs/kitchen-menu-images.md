# Kitchen Menu Image Assets

The booking menu catalog supports real product photos from the product API and
keeps static manifest images as a fallback bridge.

## Source Priority

Booking menu cards resolve images in this order:

1. Applied product photo from `/api/products`: `products.icon_url`, exposed to
   frontend code as `iconUrl` or legacy `icon_url`.
2. Static manifest image from `js/kitchen-menu-images.js`, generated from files
   in `images/kitchen-menu/`.
3. Existing safe fallback image/emoji state.

Generated menu photos are not applied automatically. Product admins or Hermes
first create a draft under `products.ai_card_draft.imageStudio`; only an
explicit `apply` action copies the approved draft URL into `products.icon_url`.
The generated image files are stored through `services/imageStorage.js` under
`/uploads/catalog-images/items`.

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

5. Reload the CRM. Products without `products.icon_url` but with matched files
   will use manifest photos; everything else keeps the safe fallback.

## Filename Rules

The sync script matches these forms:
- product code slug: `products/menu-026.webp`, `products/cake-06.png`
- product code slug at the folder root: `menu-026.webp`, `cake-06.png`
- product id slug: `menu-2026-026-item.webp`, `cake-snikers.jpg`
- generated human names with numeric prefixes: `001_Бургер з біфштексом.jpg`
- nested section folders such as `01_Бургери/001_Бургер з біфштексом.jpg`

Preferred format is `.webp`; `.png`, `.jpg`, `.jpeg`, and `.avif` are also
accepted.

Current imported batch: 93 images matched to `MENU-*` / `CAKE-*` products.
Imported files are kept in `images/kitchen-menu/products/` with ASCII
product-code filenames so browser URLs and deployment artifacts do not depend
on ZIP filename encoding.
The batch does not include separate images for pizza add-ons, first courses,
`Склянка молока`, or `Молоко — додаток до кави`; those products keep emoji
fallbacks until images are added.

## Notes

- Do not use remote hotlinked images in production; download and keep local
  optimized assets.
- Keep images square or close to square. The UI crops with `object-fit: cover`.
- Recommended size: 512x512 or 768x768.
- The static manifest is a fallback bridge. It must not override an applied
  product photo from `products.icon_url`.
- AI/Hermes generated drafts use a card-friendly horizontal prompt and may
  store larger source files in `/uploads/catalog-images/items`; the card UI
  should crop safely without manually patching individual images.
