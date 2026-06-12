# Kitchen Menu Images

Put generated menu and cake images in this folder.

Recommended filenames:
- `menu-026.webp` for product code `MENU-026`
- `cake-06.webp` for product code `CAKE-06`
- `001_Бургер з біфштексом.jpg` also works when files come from a generated batch.
- Nested category folders also work.

Accepted extensions: `.webp`, `.png`, `.jpg`, `.jpeg`, `.avif`.

After adding images, run:

```bash
node scripts/sync-kitchen-menu-images.js
```

The script updates `js/kitchen-menu-images.js`, and the booking catalog will
show real images instead of emoji fallbacks.
