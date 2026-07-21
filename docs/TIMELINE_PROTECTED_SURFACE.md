# Timeline Protected Surface

This document owns the protected contracts around timeline booking identity and
booking detail opening. These areas caused production-visible failures when the
timeline and booking detail render paths drifted.

## Rule

The canonical booking detail UI is owned by `js/booking.js` with supporting
renderers in `js/booking-banquet-detail.js` and `js/booking-package-renderer.js`.
`js/timeline.js` may call `showBookingDetails(...)` and collect diagnostics, but
it must not render a parallel booking detail card.

The protected identity/source fields are `id`, `linkedTo`, `linked_to`,
`lineId`, `line_id`, `resourceId`, `resource_id`, `roomResourceId`,
`room_resource_id`, `date`, `time`, `duration`, `room`, `status`,
`programId`, `program_id`, `programName`, `program_name`,
`programCode`, `program_code`, `label`, `/api/bookings/detail/:id`,
`apiGetBookingById(...)`, `resolveBookingDetailsRecord(...)`, and
`showBookingDetails(...)`.

Any change to those priorities, DB mapping, endpoint source, timeline projection,
or modal ownership requires explicit product/owner approval before code edits.

## Guard

`npm run check:timeline-protected-surface` reads
`config/timelineProtectedSurface.js`, extracts the critical source blocks, and
checks their `sha256` hashes. If one of those blocks changes, CI fails until the
manifest is updated with an explicit approval record.

Protected blocks:

| Block | Owner | File | Purpose |
| --- | --- | --- | --- |
| `booking-detail-identity` | `booking-detail` | `js/booking.js` | Detail modal identity resolution and line/resource fallbacks. |
| `booking-detail-safe-open` | `booking-detail` | `js/booking.js` | Canonical detail open path and safe optional section rendering. |
| `timeline-open-diagnostics` | `timeline` | `js/timeline.js` | Timeline block click, fallback, and diagnostic codes. |
| `route-attach-timeline-identity` | `bookings-api` | `routes/bookings.js` | Backend timeline identity attachment for created/linked bookings. |
| `route-project-timeline-identity` | `bookings-api` | `routes/bookings.js` | Timeline projection and visibility rules for animator/room views. |
| `service-booking-row-map` | `booking-service` | `services/booking.js` | DB row to frontend booking identity mapping. |

Forbidden timeline details fallbacks:

- `TL-BK-DETAIL-RECOVERY-OPENED`
- `Recovery після detail API`
- direct `bookingDetails.innerHTML` writes from `js/timeline.js`

## Approval Flow

1. State why the protected contract must change.
2. Add or update focused regression tests first.
3. Change the code.
4. Recompute the affected block hash.
5. Update `config/timelineProtectedSurface.js` with `approvedBy`,
   `approvedOn`, and `reason`.
6. Run `npm run check:timeline-protected-surface`, focused tests, and then
   `npm test`.

Do not update the hash just to make CI green.

## Approval Log

- 2026-07-21, `booking-detail-identity` and `booking-detail-safe-open`: explicit product-owner Task 4 approval. Active banquet groups with a cancelled or missing primary remain readable, but canonical detail/edit flow suppresses mutation controls and can open only a clean standard replacement form without restoring the primary or transferring customer, deposit, or membership data.
- 2026-07-17, `route-project-timeline-identity` and `service-booking-row-map`: explicit product-owner approval for room identity Task 3. `room_resource_id` is now the first room projection identity and is exposed by the canonical booking row mapper; legacy room text remains a recovery/display snapshot.
- 2026-07-13, `booking-detail-safe-open`: explicit product-owner approval for the arrival consistency task. Canonical banquet detail now reads guest arrival from the banquet group snapshot and never relabels the opened kitchen/activity member time as arrival.
- 2026-07-13, `route-project-timeline-identity`: explicit product-owner approval for Task 5. Room timeline projection now resolves active rooms to durable resource IDs, preserves legacy room text separately, and sends unmatched or inactive room identities to a non-assignable quarantine lane instead of the takeaway row.
- 2026-07-12, `booking-detail-safe-open`: explicit product-owner approval for a security fix. Customer name, phone, and Instagram copy actions now use encoded `data-*` attributes with one delegated handler instead of inline JavaScript; canonical booking detail identity, API source, and modal ownership are unchanged.
- 2026-07-07, `booking-detail-safe-open`: booking detail invite generation now receives the resolved banquet snapshot so public invite links can carry canonical banquet arrival time while keeping private booking/customer fields out of the URL.
