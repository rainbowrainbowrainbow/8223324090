# Admission Ticket Contract

Date: 2026-07-18

Status: implemented in the current local worktree; migration, catalog API,
booking quote/save flow, Center UI, booking UI, banquet summary, PDF, finance
synchronization, and regression coverage are present. This status does not
claim that the worktree has been released, passed CI, deployed, or accepted by
live-site QA.

Production impact: yes.

## Source Of Truth

- Admission context rules: `services/ticketTariffContract.js`.
- Catalog, quote, validation, and append-only tariff revisions:
  `services/admissionTickets.js`.
- Atomic booking-to-finance synchronization:
  `services/bookingFinanceSync.js`.
- Banquet ownership, write-path, alias, and integrity guards:
  `services/banquetGroups.js`.
- Persisted booking snapshot: `extra_data.bookingPackage`, schema version `3`.
- Durable catalog schema and initial approved tariff matrix:
  `db/migrations/300_admission_ticket_catalog.sql`.

Clients submit only canonical counts and the four manual ticket quantities.
Ticket names, prices, subtotals, admission context, tariff version IDs, and the
persisted v3 snapshot are server-owned. A new or altered raw client-supplied v3
snapshot is rejected; an unchanged existing snapshot is recognized only to
preserve a historical ticket state safely. Guards scan all camel/snake-case
top-level and `extraData` aliases, so an empty decoy package cannot hide a
forged snapshot. Only the canonical top-level `ticketQuote` returned by the
server may be confirmed on save.

## Ticket Types And Allocation

The six system ticket types are:

| Code | Audience | Allocation | Approved price |
| --- | --- | --- | --- |
| `regular_child` | child | automatic remainder | standard: 350 weekday / 400 weekend; reserved: 310 / 350 |
| `under_3_child` | child | manual | 175 weekday; unavailable on weekends |
| `discounted_child` | child | manual | 175 weekday / 200 weekend |
| `birthday_child` | child | manual | 10 |
| `adult_companion` | adult | automatic remainder | 10 |
| `adult_game` | adult | manual | 75 |

`discounted_child` represents the selected discount reason
(large family, combatant status, disability, orphan status, or internally
displaced status). The reason/eligibility is checked operationally; the pricing
formula receives one non-stacking discounted quantity.

The server derives:

```text
regular_child =
  banquet_guests - birthday_child - under_3_child - discounted_child

adult_companion =
  banquet_adults - adult_game
```

Both remainders must be non-negative. All quantities must be non-negative safe
integers. `banquet_guests` is the child-count source of truth. `kids_count` is a
compatibility mirror: it is compared only when explicitly supplied by the
current request and is synchronized to the accepted child total on save.

## Admission Context

The only contexts are:

- `standard`;
- `reserved_table_room`.

For an existing booking, `reserved_table_room` requires all of:

1. active membership in an active banquet group in the same
   `business_context`;
2. a non-empty `room_resource_id`;
3. an active same-context `timeline_resources(type='room')` row;
4. a resource other than `room-takeaway`.

Existing-group quote previews may send `banquetGroupId` and
`sourceBookingId`, but both are identifiers only. The server verifies that the
group is active, the source booking is an active member in the same business
context, and the actor may edit that booking before using the persisted group
and room evidence. Supplying arbitrary IDs never unlocks the reserved tariff.

For a new booking, reserved preview/save is allowed only when the request carries
a validated `banquetContext.mode = "new"` with a valid `guestArrivalTime`, and
the same transaction creates the banquet group. A generic physical-room booking
without that contract uses `standard`.

Room display text, table count, deposit, payment state, menu amount, and a
client-provided admission-context field are never pricing evidence.

Membership operations that would change the context of an already ticketed
booking fail with `TICKET_FULL_EDIT_REQUIRED`. This prevents a standard or
reserved snapshot from silently surviving attach/detach/automatic grouping
without an atomic fresh quote.

## Tariff Versions

- Contract effective date: `2026-07-14`.
- The visit date selects the latest version with
  `effective_from <= visit_date`.
- Saturday and Sunday are `weekend`; Monday through Friday are `weekday`.
- Ticket dates are date-only `YYYY-MM-DD`; default catalog dates use
  `Europe/Kyiv`.
- An unavailable tariff is distinct from an available zero-price tariff.
- Every available tariff amount accepted by the application is a whole UAH
  integer from `0` through `2147483647`, compatible with the PostgreSQL
  `INTEGER` used by `bookings.price`. Decimal, negative, non-safe, and
  out-of-range amounts are rejected; unavailable tariffs require `NULL`.
- `line_subtotal = quantity * unit_price`.
- `ticket_subtotal = sum(line_subtotal)`.
- Unit prices, line subtotals, and the final ticket subtotal must remain safe
  integers inside the same PostgreSQL `INTEGER` range.
- Tariff changes append a new revision; existing revisions are not overwritten.
- Optimistic locking uses the latest revision for a ticket/context/day,
  including scheduled future revisions. The catalog exposes both the effective
  tariff and the revision head so the editor cannot loop on a stale revision.

Tariff revision and booking save are mutually serialized:

- append locks the selected `admission_ticket_types` row `FOR UPDATE` before it
  reads the revision head and inserts the next revision;
- ticket save locks all six ticket-type rows `FOR SHARE` in stable code order
  before it reloads tariffs and compares the submitted quote;
- therefore append waits for an in-flight save and save waits for an in-flight
  append. A quote cannot pass comparison and then persist against a tariff
  revision committed in the gap.

Every quote has `quoteContractVersion = 1` and a deterministic SHA-256
fingerprint over business/admission context, visit date, day type, currency,
all six normalized quantities, tariff IDs, unit prices, line subtotals, and the
ticket subtotal. `pricedAt`, display names, booking ID, and line order are not
part of the fingerprint.

On save, the server recalculates the full quote and compares the canonical
projection with the client preview:

- a tariff-only change returns `TICKET_PRICE_CHANGED`;
- a quantity, visit date, day type, currency, or admission-context change
  returns `TICKET_QUOTE_CHANGED`.

Both responses contain the fresh quote and structured diff. The confirmed
server quote, never client amounts, is written to booking package v3.

An unrelated edit may preserve a stored v3 snapshot only after strict
validation. The validator requires:

- schema version `3` or newer and a ticket-lines array;
- known, unique ticket codes and positive safe-integer quantities;
- whole-UAH unit prices and subtotals inside the PostgreSQL `INTEGER` range;
- exact `quantity × unit price = line subtotal` arithmetic;
- a positive tariff-version ID on every line;
- an exact stored-total match and, when present, a valid quote fingerprint.

A malformed stored snapshot fails closed with `TICKET_SNAPSHOT_INVALID`; the
write path does not silently normalize or repair it. A structurally valid old
v3 snapshot without a fingerprint remains readable and may receive the
deterministic fingerprint during an unrelated edit without repricing.

## Legacy And Ownership

- Package v2 `entryCharge` remains readable and is preserved during unrelated
  edits.
- An unrelated edit of a package with no ticket payload preserves that package
  without creating a legacy entry charge or silently converting it to v3.
- Conversion to v3 requires all three: `convertLegacy: true`, explicit manual
  quantities, and a fresh server quote.
- Legacy rows may use `kids_count` as the child-count fallback and `0` adults
  only during explicit conversion.
- A manual menu position named `Вхід` cannot be combined with canonical ticket
  lines. The server returns `TICKET_MANUAL_ENTRY_CONFLICT` instead of charging
  both representations.
- A banquet group may have at most one active material package owner and at most
  one active v3 ticket snapshot. Material package evidence includes menu
  positions, service events, `banquetMenu`, legacy `entryCharge`, and v3 data.
- Activity creation endpoints reject ticket/package payloads on both the
  activity root and its linked children. Full banquet creation and member
  attach/create paths also reject material package data on an activity or any
  non-owner booking with `TICKET_PACKAGE_OWNER_REQUIRED`.
- `banquet_groups.meta.ticketBookingId` identifies the ticket snapshot owner;
  `packageOwnerBookingId` identifies the canonical package owner.
- Actual persisted package data takes precedence over stale owner metadata.
  Multiple material owners fail closed with
  `BANQUET_PACKAGE_OWNER_CONFLICT`; stale ticket-owner metadata without a
  snapshot fails with `TICKET_PACKAGE_OWNER_METADATA_INVALID`.
- Package-owner date, room/resource, and customer identity are updated together
  with the primary booking through the atomic banquet `booking-set` endpoint.
  Generic update/delete and linked-atomic context changes of active group
  members are rejected before mutation.
- Direct confirm/preliminary status changes for an active banquet group are
  rejected with `BANQUET_PACKAGE_OWNER_REQUIRES_ATOMIC_ENDPOINT`; the group must
  be changed through `booking-set`. The payment patch is transactional, performs
  strict ticket finance synchronization, and bumps the group update version so
  a stale `booking-set` cannot overwrite it.
- Stored recurring templates are checked inside the generation service, not
  only at the HTTP boundary. Manual quantities, a quote, v3 snapshot, or legacy
  `entryCharge` fail with `TICKET_RECURRING_UNSUPPORTED`; generate-all reports a
  blocked template and continues with ticket-safe templates.
- Banquet summary/PDF resolves tickets from that owner independently of the
  kitchen/menu booking, so ticket rows are counted exactly once.
- The banquet read model emits `multiple_kitchen_bookings` when more than one
  kitchen/menu candidate exists, making ambiguous package ownership visible
  before edit or print.

Camel/snake-case aliases are accepted for compatibility only when they carry
the same value. Conflicting aliases, including hidden copies in `extraData`,
fail before the transaction with `BOOKING_FIELD_ALIAS_CONFLICT`. The check
covers booking/source IDs, room and customer identity, guest/adult/table counts,
ticket quantities and quote, conversion flag, package data, and nested
`extraData`.

## Booking Price And Finance

- `booking.price` is the effective booking total after package/menu and ticket
  calculation; the ticket subtotal is not added twice.
- Ticket-bearing booking writes and atomic banquet writes synchronize the
  canonical non-certificate income row in the same database transaction with
  `optional: false`. This includes the relevant create/full/update,
  `booking-set` member/activity, ticket status, and payment-method paths.
- A confirmed positive-price booking inserts or updates one row. Preliminary,
  cancelled, and zero-price states remove one stale canonical row instead of
  leaving finance out of sync.
- Synchronization is idempotent and serialized by a transaction-scoped advisory
  lock. All matching non-certificate rows are locked before mutation.
- More than one matching row fails closed with
  `BOOKING_FINANCE_DUPLICATE_ROWS`; the code neither picks one arbitrarily nor
  deletes duplicates.
- A missing `Бронювання` income category fails with
  `BOOKING_FINANCE_CATEGORY_MISSING`. On strict ticket/banquet paths either
  error rolls back the booking/group write together with finance.
- Older non-ticket paths may retain their existing optional savepoint behavior;
  that fallback is not part of the ticket/banquet atomicity guarantee.
- The existing canonical deposit projection remains unchanged. UI/summary/PDF
  show the remaining amount from the effective booking total and the canonical
  deposit; ticket pricing does not infer payment state.

The communicated menu minimums (room: 4000 UAH, table: 2500 UAH) and the 2000
UAH booking deposit are operational booking rules, not tariff evidence. This
ticket feature displays existing menu/deposit data but does not introduce
automatic minimum-order enforcement or change deposit/payment logic.

## Access

- Catalog read: `manager` or higher.
- Tariff revision create: `senior_manager` or higher.
- Quote: existing `edit_booking` action plus `canEditBooking` for a referenced
  booking.
- Frontend visibility is not authorization; all gates are enforced by the
  server.

## UI Contract

- Center → Tickets displays the 6 × 4 tariff matrix, history, effective tariff,
  and revision head.
- Booking UI exposes four manual quantities and two read-only automatic
  remainders.
- Child and adult allocations show allocated/total counts.
- A v3 snapshot with `ticketLines: []` remains a valid v3 zero-ticket state.
- Legacy-entry, no-ticket, new, and v3 states are distinct.
- Opening and saving an untouched v3 booking sends no ticket mutation payload,
  so an unrelated edit cannot reprice historical tickets.
- Only the canonical package owner exposes editable package/ticket controls;
  grouped non-owner forms use the atomic group save contract.
- In-flight quote responses are scoped to the current booking form session.
- A stale quote response remains sticky until the manager reviews quantity,
  context, subtotal, and tariff differences and confirms the fresh calculation.
- Ticket/catalog names, requirement text, and quote-conflict details are escaped
  before HTML rendering.

## Local Implementation Versus Release Acceptance

The implementation inventory in this document describes the current local
worktree. This hardening does not itself add a version bump or claim a release.
Commit/push, CI, production deploy, browser acceptance, and live-site QA are
separate delivery evidence and must be recorded by the delivery task before the
feature is called released.

The ticket contract has focused unit/static/integration coverage in the
repository, but test presence is not the same as a passing result for the final
worktree. Record the exact result of the commands below after all code changes
are complete.

## Verification

Required fast checks:

```bash
npm run check:runtime
npm run test:ticket-contract
node --test tests/booking-package-contract.test.js
node --test tests/booking-banquet-links.test.js
npm run check:syntax
```

PostgreSQL-backed integration coverage:

```bash
npm run test:integration:admission-tickets:isolated
```

Before production release, verify manager read-only access, senior-manager
tariff editing, standard and reserved quote/save flows, explicit legacy
conversion, weekend `under_3_child` rejection, ticket rows in booking detail,
banquet summary/PDF, finance insert/update/removal and fail-closed recovery
cases, recurring/status/activity guards, the multiple-kitchen warning, and the
due amount after deposit.

Acceptance must not treat the displayed operational menu/deposit information as
proof of automatic minimum-order or deposit enforcement.
