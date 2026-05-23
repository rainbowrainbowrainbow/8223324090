# Page: Warehouse

## Route / Location

- Route: `/warehouse`
- Static file: `warehouse.html`
- Page controller: `js/warehouse-page.js`
- Backend routes: `routes/warehouse.js`, `routes/procurement.js`
- Related navigation item: System group -> `Склад`

## Purpose

Warehouse is inventory, stock movement, owner/location, low-stock/procurement, and contractor-linked warehouse operations.

## Primary Entities

- Warehouse item
- Stock movement
- Location
- Procurement order
- Contractor

## Visible UI

- Inventory table/cards.
- Filters and item edit controls.
- Procurement/order/low-stock surfaces.

## Available User Actions

- View/add/edit/delete stock items.
- Receive/move stock.
- Create procurement orders.
- Export stock/procurement data.

## Data Sources

- `routes/warehouse.js`
- `routes/procurement.js`
- `db/migrations/006_warehouse_and_users.sql`
- `db/migrations/097_warehouse_pinata.sql`
- `db/migrations/184_warehouse_multi_location_contractors.sql`

## Related Files

- `warehouse.html`
- `js/warehouse-page.js`
- `routes/warehouse.js`
- `routes/procurement.js`

## Assistant Context

On Warehouse, interpret user questions around stock quantity, location, low-stock risk, movement history, and procurement action.
