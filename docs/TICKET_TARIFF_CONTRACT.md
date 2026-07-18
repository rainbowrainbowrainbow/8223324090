# Ticket Tariff Contract

Date: 2026-07-18
Status: foundation contract; ticket storage/API/UI are not implemented in this task.
Production impact: yes.

## Decision

The server-side source of truth is `services/ticketTariffContract.js`. Ticket
implementation must not derive a lower price from room display text or from an
untrusted request field.

The only admission contexts are:

- `standard`;
- `reserved_table_room`.

`reserved_table_room` applies only when all of the following canonical server
evidence exists:

1. the persisted booking has an active membership in a non-cancelled banquet
   group in the same `business_context`;
2. the persisted booking has a non-empty `room_resource_id`;
3. that ID resolves in the same context to an active
   `timeline_resources(type='room')` row;
4. the ID is not `room-takeaway`.

If any condition is missing or inconsistent, the context is `standard`. The
server must load the booking, banquet membership/group, and room resource from
the database. A request may identify the booking but may not submit trusted
admission-context evidence.

## Evidence That Must Not Affect Context Or Price

The following are never proof of `reserved_table_room` and never unlock a lower
tariff:

- `bookings.room` or any other room label/text;
- `banquet_tables` (table quantity only);
- deposit amount or deposit existence;
- payment status, payment method, or paid amount;
- minimum-menu amount or selected menu positions;
- a client-supplied `admissionContext` / `admission_context` value.

## Tariff Applicability

- Contract effective date: `2026-07-14`.
- The visit/booking date selects a tariff version. The server chooses the latest
  catalog version whose `effective_from <= visit_date`; it never uses request
  time or quote-creation time as the tariff date.
- `weekend` means Saturday or Sunday. Monday through Friday are `weekday`.
- Business timezone for date interpretation is `Europe/Kyiv`; ticket dates are
  persisted and compared as date-only `YYYY-MM-DD` values.
- Audience code `under_3` on a weekend is unavailable. It is not a zero-price
  ticket and must fail closed with an unavailable result.
- A quote line has exactly one base tariff for its effective version, admission
  context, day type, and audience/category dimensions.
- Zero matching tariffs means unavailable; multiple matching tariffs mean a
  catalog configuration error. Neither case may fall back to a guessed value.
- At most one eligible special tariff may replace the base tariff. Special
  tariffs never stack with each other and are never added to or multiplied by
  the base tariff. Multiple eligible special tariffs are an ambiguity error.
- `line_subtotal = quantity * applied_unit_price`.
- `quote_total = sum(line_subtotal)` for all available lines. No deposit,
  payment, menu, or room-label value participates in either formula.

Tariff amounts are catalog data, not hard-coded formula constants. Task 1 does
not invent missing owner-approved amounts. Migration `300` must introduce the
ticket catalog/schema and seed only explicitly approved tariff values.

## Access Contract

- Catalog read: role level `manager` or higher.
- Tariff create/update/archive: role level `senior_manager` or higher.
- Ticket quote: the actor must pass the existing `edit_booking` action policy
  and must be allowed to edit the referenced booking through
  `canEditBooking(user, booking)`.
- Tariff mutation and quote endpoints must enforce these rules on the server;
  frontend visibility is not authorization.

## Migration Contract

After room-resource migration `296` and the already merged migrations
`297`-`299`, the next ticket migration number is reserved as `300`.

Task 1 does not create migration `300`. This prevents ticket schema work from
being mixed with the completed room-resource schema/backfill. Before creating
the ticket migration, fetch the deploy branch and rerun `npm run
check:migrations`; if another merged migration has taken `300`, renumber the
ticket migration before merge rather than creating a duplicate.

## Room Foundation Dependency

New and edited Event Genix booking, banquet, booking-template, and recurring
write paths must continue to persist a validated `room_resource_id`. Legacy
ambiguous rows may remain `NULL` and therefore always resolve to `standard`
until explicitly repaired. `room-takeaway` remains virtual and can never satisfy
the active-physical-room condition.

## Verification Contract

Automated coverage must prove:

- only the two admission contexts are emitted;
- room text, `banquet_tables`, deposit/payment/menu fields and client context do
  not affect admission context;
- inactive, missing, cross-context, mismatched, and takeaway resources resolve
  to `standard`;
- Saturday/Sunday classification and weekend `under_3` unavailability;
- special tariff replacement without stacking;
- manager/senior-manager/edit-booking access boundaries;
- migration `300` is the next free number at Task 1 closure.
