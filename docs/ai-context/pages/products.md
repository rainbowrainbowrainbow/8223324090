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
- Generate one AI icon per program through Products -> AI-іконки програм. The icon pipeline is manual, single-program only, and stores the final image under CRM uploads.

## AI Icon Configuration

- `OPENROUTER_API_KEY` enables OpenRouter image generation.
- `PROGRAM_ICON_IMAGE_PROVIDER=auto` uses OpenRouter when `OPENROUTER_API_KEY` is configured and otherwise keeps the legacy Kie.ai provider.
- Default cheap OpenRouter image model: `openai/gpt-5-image-mini`.
- Prompt refinement model can be changed with `PROGRAM_ICON_PROMPT_MODEL` or from the Products AI-icon settings modal.
- Do not store provider keys in repo files or product settings JSON; keys must stay in production env variables only.

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
