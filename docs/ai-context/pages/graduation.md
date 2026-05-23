# Page: Graduation

## Route / Location

- Route: `/graduation`
- Embed alias: `/embed/graduation`
- Static file: `graduation.html`
- Backend route: `routes/graduation.js`
- Related navigation item: Product group -> `Випускний`

## Purpose

Graduation is the event builder for graduation packages, diplomas, lists of children, catalog items, and graduation operations automation.

## Primary Entities

- Graduation quote/booking
- Diploma batch
- Child roster/list pack
- Graduation catalog/product
- Capsule of time
- Print reminder/task

## Visible UI

- Graduation builder and catalog areas.
- Diploma/list pack surfaces.
- Preview/print/PDF controls where supported.

## Available User Actions

- Configure graduation services.
- Manage diploma/children lists.
- Generate/preview/export diplomas.
- Open catalog and print workflows.

## Data Sources

- `routes/graduation.js`
- `services/graduationDiplomas.js`
- `services/graduationOpsAutomation.js`
- `db/migrations/072_graduation.sql`
- `db/migrations/198_graduation_list_packs.sql`
- `db/migrations/203_graduation_ops_automation.sql`

## Related Files

- `graduation.html`
- `routes/graduation.js`
- `services/graduationDiplomas.js`

## Assistant Context

On Graduation, interpret "список дітей", "дипломи", "друк", and "капсула часу" as graduation operations dependencies, not generic tasks.
