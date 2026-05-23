# Page: Designs

## Route / Location

- Route: `/designs`
- Embed alias: `/embed/designs`
- Static file: `designs.html`
- Page controller: `js/designs-page.js`
- Backend routes: `routes/designs.js`, `routes/catalogs.js`
- Related navigation item: Product group -> `Дизайн-борд`

## Purpose

Designs is the design/catalog workspace for assets, collections, calendar, tags, uploads, Telegram send, and catalog viewer/editor surfaces.

## Primary Entities

- Design asset
- Collection
- Catalog definition/page
- Catalog item
- Tag

## Visible UI

- Design board/list.
- Upload and asset cards.
- Collections/tags/calendar.
- Catalog inline/viewer modes.

## Available User Actions

- Upload/manage design assets.
- Edit/delete/download/send assets.
- Open catalog surfaces.
- Generate or apply catalog media.

## Data Sources

- `routes/designs.js`
- `routes/catalogs.js`
- `services/imageStorage.js`

## Related Files

- `designs.html`
- `js/designs-page.js`
- `routes/designs.js`

## Assistant Context

On Designs, treat catalog questions as visual/public catalog work, and design questions as asset/collection workflow.
