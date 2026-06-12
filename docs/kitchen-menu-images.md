# Kitchen Menu Image Assets

The booking menu catalog supports real product photos without changing the
database or the booking payload.

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

5. Reload the CRM. Products with matched files will use photos; everything else
   keeps the emoji fallback.

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
- This is a frontend manifest bridge. A future product-admin image field can
  replace it without changing `bookingPackage.menuPositions`.
