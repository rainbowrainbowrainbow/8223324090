# Entity: Catalog Item

## Meaning

A Catalog Item is a visual/public product entry used by catalog definitions/pages, especially in Designs and Products catalog surfaces.

## Fields / Properties

Source evidence: `routes/catalogs.js`.

- `id`
- catalog id/definition
- page number
- title/name
- description
- image/media
- price fields
- status/deleted/restored state
- sort/order metadata

## Related Entities

- Catalog Item may represent Product.
- Catalog belongs to catalog definition/pages.
- Catalog can have generated cover/images and public link.

## Where It Appears

- Products -> Catalogs.
- Designs catalog viewer/editor.
- Public `/catalog/:slug/:token`.

## Assistant Interpretation

On catalog pages, distinguish item content from canonical product data. If uncertain, say whether the user is editing catalog presentation or product source data.
