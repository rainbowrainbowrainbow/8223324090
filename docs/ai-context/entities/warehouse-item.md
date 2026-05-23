# Entity: Warehouse Item

## Meaning

A Warehouse Item is an inventory/stock item in warehouse operations.

## Fields / Properties

Source evidence: `routes/warehouse.js`, warehouse migrations.

- id
- name
- quantity/stock
- unit
- location/owner
- low-stock thresholds
- movement/history metadata

Status: exact field set should be confirmed before schema-level answers.

## Related Entities

- Warehouse item can create Procurement Order.
- Warehouse item can link to Product stock.
- Warehouse item may have owner/location/contractor metadata.

## Where It Appears

- Warehouse page.
- Procurement routes.
- Products stock linkage.

## Assistant Interpretation

On Warehouse, ask whether the user needs current quantity, low-stock risk, movement history, or procurement action.
