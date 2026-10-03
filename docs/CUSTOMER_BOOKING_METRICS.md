# Customer booking metrics

The read-time aggregate in `services/customerBookingMetrics.js` owns customer
list, search, detail, statistics, lifecycle counts, CSV/XLSX exports, and RFM.
Stored customer totals and dates are historical caches, never a fallback for an
empty aggregate. No historical customer or booking records are rewritten.

## Included records and value

- Use the current booking row, exact customer ID, business scope, and existing
  booking visibility policy. Do not infer ownership from phone, name, or lead.
- Count root bookings whose normalized status is `confirmed` or `preliminary`.
  Exclude `cancelled`, missing, and unknown statuses. Do not invent `completed`.
- A null, empty, or whitespace-only `linked_to` identifies a root. Technical
  children with a parent reference are excluded, including orphan children and
  children with a positive price. They do not become separate customer visits.
- Independent root activities are separate bookings even when grouped as one
  banquet/event. The metric counts booking records, not unique visits/events.
- Sum the saved root `price` once. It already contains the saved package total;
  do not add `extra_data.bookingPackage.finalTotal`, menu positions, entry charges,
  or technical children again. A separately priced independent activity is counted
  once as its own root. Do not reconstruct historical prices from today's catalog.
- Null/negative prices contribute no monetary value and increment
  `unpricedBookings`; UI marks the value as incomplete. Explicit zero is valid.
- `totalSpent` is retained for API compatibility, but UI calls it
  **Вартість бронювань**. It does not describe payment, income, or money received.

## Dates and filters

One date boundary per query is calculated in `Europe/Kyiv`.

- `pastBookings`: included root bookings with `date < metricsAsOf`.
- `plannedBookings`: included root bookings with `date >= metricsAsOf`;
  today's records remain planned regardless of current time.
- `undatedBookings`: included roots with no date.
- `preliminaryBookings`: included preliminary roots, independent of their dates.
- `firstVisit`/`lastVisit`: earliest/latest **past booking date**, including
  preliminary records. They are labeled accordingly; they do not prove attendance.
- `nextBookingDate`: earliest included date today or later.
- List `dateFrom`/`dateTo` and `sortBy=last_visit` use the same live
  `real_last_visit` expression as the visible **Останнє минуле** date.
  Customers without a past date do not match a bounded past-date filter.
- `sortBy=next_booking` sorts the visible nearest planned date. Null dates go last;
  customer ID breaks ties consistently across pagination.
- DATE values are projected as `YYYY-MM-DD` text to avoid timezone shifts.
- Detail summary covers all eligible history, while the history panel shows up to
  50 latest root records, including cancelled records with their explicit status.
  The header uses the aggregate's nearest date. If its record is outside that
  window, show the date and the missing-detail explanation, never a later record.
- Moving a booking changes the current row's date and therefore its membership,
  last/next date, and RFM immediately. No old date is inferred from cache.

## RFM and LTV

RFM is preliminary, relative cohort analysis. Only roots with the explicit status
`confirmed` and a date before today are eligible. Frequency counts those records,
monetary sums their valid saved prices, and recency is a difference of calendar
dates. Today's and future bookings cannot create negative recency.

Customers without eligible history get `no_history`, null scores, and a separate
`noHistory` count. They are excluded from percentile cohorts and from `lost`.
The existing percentile segmentation otherwise remains unchanged; historical date
and `confirmed` still do not prove attendance or payment. Main-list past dates can
include preliminary records, so they intentionally differ from the RFM cohort.

Predictive LTV and its flame badge are removed. `/ltv` returns explicit HTTP 410,
and `sortBy=ltv` returns HTTP 400 rather than silently changing the sort order.
Existing financial response shaping, permissions, and payment models are unchanged.

## Verification

- Unit/UI: `node --test tests/customer-booking-metrics.test.js`.
- Actual PostgreSQL: `npm run test:integration:omni-links:isolated` includes
  `tests/integration/customer-booking-metrics-postgres.test.js` in the existing
  disposable PostgreSQL CI job. It never uses production `DATABASE_URL`.
- Live QA after an authorized release: use registered test records for empty,
  future, today, past, preliminary, cancelled, moved, and linked/package cases;
  compare list → detail → date filter → date/value sort → RFM. No messages or
  payment operations are required.
