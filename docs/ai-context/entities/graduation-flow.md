# Entity: Graduation Flow

## Meaning

Graduation Flow is a specialized product/operations domain covering graduation packages, diplomas, children lists, print readiness, capsule of time, and timeline/task automation.

## Fields / Properties

Source evidence: `routes/graduation.js`, `services/graduationDiplomas.js`, `services/graduationOpsAutomation.js`.

- quote/booking id
- services/positions
- child roster/list pack
- diploma batch
- print readiness/reminder state
- capsule prep/order state

## Related Entities

- Links to Booking.
- Creates Tasks/reminders.
- Uses Product/Catalog items.
- Generates PDF/print artifacts.

## Where It Appears

- Graduation page.
- Timeline.
- Products/Catalogs.
- Tasks.

## Assistant Interpretation

If user mentions "дипломи", "список дітей", or "капсула часу" in graduation context, treat them as operational readiness dependencies.
