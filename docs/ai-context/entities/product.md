# Entity: Product

## Meaning

Product is the broad product/catalog object for programs, kitchen/menu/cakes, catalog items, and package/product surfaces.

## Fields / Properties

Source evidence: `routes/products.js`, `routes/catalogs.js`, recent product migrations.

- name/title
- category/subcategory/domain
- price and price unit/mode
- descriptions
- ingredients/tech card for kitchen/menu
- active/deleted state
- sort order

## Related Entities

- Product can be selected in Booking.
- Product may become a Catalog Item.
- Product may have price rules.
- Product may belong to business context: Park or Maysternya.

## Where It Appears

- Products page.
- Timeline booking panel.
- Designs/catalogs.
- Graduation catalog.

## Assistant Interpretation

If user says "продукт" on `/programs`, use product hub context. If user says "меню" or "торти", use kitchen/menu/cakes subtype context.
