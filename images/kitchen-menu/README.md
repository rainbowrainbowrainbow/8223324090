# Kitchen Menu Images

Generated menu and cake photos live here.

Recommended filenames:
- `products/menu-026.webp` for product code `MENU-026`
- `products/cake-06.webp` for product code `CAKE-06`
- root-level `menu-026.webp` / `cake-06.webp` also works for one-off imports
- generated human filenames and nested category folders are supported by the sync script, but production manifests should use ASCII product-code paths

Accepted extensions: `.webp`, `.png`, `.jpg`, `.jpeg`, `.avif`.

After adding images, run:

```bash
node scripts/sync-kitchen-menu-images.js
```

The script updates `js/kitchen-menu-images.js`, and the booking catalog will
show real images instead of emoji fallbacks.
