# Page: Products

## Route / Location

- Route: `/programs`
- Embed alias: `/embed/programs`
- Static file: `programs.html`
- Page controller: `js/programs-page.js`
- Backend routes: `routes/products.js`, `routes/catalogs.js`, `routes/packages.js`
- Related navigation item: Product group -> `Продукти`

## Purpose

Products is the product hub for park products, programs, kitchen/menu/cakes surfaces, catalogs, and business-specific product context.

## Primary Entities

- Product
- Program/package
- Kitchen item
- Menu item
- Catalog definition/item
- Price rule

## Visible UI

- Business selector for product context.
- Product IA tabs/panels for programs, kitchen, catalogs.
- Product cards/lists and editing flows.
- Catalog entry cards.

## Available User Actions

- Switch product business context.
- View and edit product/program data.
- Manage kitchen/menu/cakes items.
- Open catalog surfaces.
- Generate/apply catalog media where supported.

## Data Sources

- `routes/products.js`
- `routes/catalogs.js`
- `routes/packages.js`
- `db/migrations/180_product_price_rules.sql`
- `db/migrations/199_products_kitchen_fields.sql`
- `db/migrations/200_products_menu_structure_fields.sql`
- `db/migrations/201_kitchen_cakes_catalog.sql`

## Related Files

- `programs.html`
- `js/programs-page.js`
- `routes/products.js`
- `routes/catalogs.js`

## Assistant Context

On Products, distinguish park products from Maysternya Doli context. If the user says "меню", prefer Products -> Kitchen/Menu. If the user says "каталог", prefer catalog surfaces.
