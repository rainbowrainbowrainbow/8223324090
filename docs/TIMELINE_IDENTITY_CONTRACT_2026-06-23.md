# Timeline Identity Contract

Production impact: yes.

This contract defines how booking rows attach to timeline lines/resources so create responses, reloads, and frontend matching use the same identity.

## Source Of Truth

- Park/default animator timeline uses `lines_by_date` as the canonical line source.
- Resource-based timelines use `timeline_resources` as the canonical resource source.
- A booking row's stored `bookings.line_id` must match `extra_data.timelineIdentity.lineId`.
- `extra_data.timelineIdentity.resourceId` must match the same canonical line/resource used by `timelineProjection.resourceId`.
- `timelineProjection.lineId` and `timelineProjection.resourceId` must remain stable between `POST /api/bookings/full` and `GET /api/bookings/:date`.

## Linked Animator Rows

- A linked animator booking is its own timeline row and must keep its own canonical `line_id`.
- Linked rows are resolved once through `ensureBookingTimelineLine(...)` during create/full.
- Linked rows must not be passed through a second resolver that can rewrite `line_id` or `extra_data.timelineIdentity`.
- Auto-created second animator rows use `ensureSecondAnimatorLineForBooking(...)` before they are appended, then follow the same linked-row insert contract.

## View Rules

- Animator timeline displays valid activity/animation rows with a canonical animator resource.
- Rows without a resolvable animator resource stay hidden with `missing_animator_resource`.
- Rooms timeline rules are separate: linked animator child rows remain hidden from rooms view unless a separate product-rule task changes that behavior.

## Frontend Matching

- `js/timeline-resource-identity.js` must prefer canonical `timelineProjection` for the active view.
- Frontend matching must use the backend-projected resource/line identity instead of guessing from stale room names or legacy fields when projection exists.
