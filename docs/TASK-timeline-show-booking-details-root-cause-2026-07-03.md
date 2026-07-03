# TASK: Find Why Canonical `showBookingDetails` Fails After Detail API Hit

- Status: open follow-up after recovery rollback
- Type: investigation + fix task
- Production impact: yes
- Parent: `docs/TASK-timeline-booking-details-canonical-interface-2026-07-03.md`

## Goal

Find and fix the real reason `showBookingDetails(...)` does not open the
canonical details modal when `/api/bookings/detail/:id` returns a booking.

## Known Evidence

- Live version `0.77.108` is deployed and confirmed by Railway proof.
- The toast/code path reached `TL-BK-DETAIL-OK-OPEN-FAILED`.
- That means the detail API returned the booking, but the frontend did not open
  the canonical modal.
- The recovery UI hid the root cause by drawing a separate details card.
- In `v0.77.109`, the recovery UI was removed so any remaining failure should
  surface as a diagnostic toast and console warning rather than a parallel UI.

## Investigation Targets

- `js/booking.js`
  - `resolveBookingDetailsRecord(...)`
  - `showBookingDetails(...)`
  - canonical modal render around `#bookingDetails`
- `js/timeline.js`
  - `openTimelineBookingDetailsFromBlock(...)`
  - linked parent/child id order
  - diagnostic callback flow
- `js/api.js`
  - `apiGetBookingById(...)`
  - `timelineApiUrl(...)` and business context query behavior
- Live browser/console
  - capture the exception thrown by `showBookingDetails(...)`;
  - verify whether it is a missing helper, field mismatch, stale asset, or
    linked-id mismatch.

## Working Hypotheses

- `showBookingDetails(...)` throws before returning `true`, possibly because a
  renderer helper is unavailable in the live asset combination.
- The first click target may be the linked parent when the visible card needs
  the child id.
- Detail payload from `/api/bookings/detail/:id` may differ from the date-cache
  payload used by the canonical renderer.
- Service Worker/cache is not the main issue anymore because live proof shows
  version `0.77.108`, but stale authenticated browser cache can still affect
  local UAT and should be checked.

## Required Fix Direction

- Fix the canonical renderer or its input data, not the timeline-owned UI.
- If the detail payload lacks fields needed by `showBookingDetails(...)`, add
  a mapper or normalization step in the canonical booking path.
- If linked-id ordering is wrong, fix the timeline click sequence while still
  opening through `showBookingDetails(...)`.
- Add regression coverage that uses the real canonical open path for linked
  booking blocks.

## Non-Goals

- Do not change protected booking source fields or DB mapping without explicit
  user approval.
- Do not change auth/roles/business visibility.
- Do not add a new endpoint unless the investigation proves the current detail
  endpoint cannot satisfy the canonical renderer.

## Acceptance Criteria

- Clicking `AH(60)` and `+Вед(60): Додатковий ведучий` opens the same canonical
  Ukrainian details modal.
- The canonical modal includes event card image, full activity fields, status,
  updated timestamp, and normal footer actions.
- No recovery UI is used.
- A failing canonical render logs a precise diagnostic and does not hide the
  exception behind `TL-BK-DETAIL-OK-OPEN-FAILED`.

## Suggested Verification

```bash
npx -y -p node@22 -p npm@10 -c "node --test tests/timeline-resources.test.js tests/booking-visibility.test.js tests/booking-drawer-encoding.test.js"
npx -y -p node@22 -p npm@10 -c "npm run test:ui"
npx -y -p node@22 -p npm@10 -c "npm test"
```

Live proof after deploy:

```bash
npx -y -p node@22 -p npm@10 -c "npm run version:smoke -- https://8223324090-production.up.railway.app"
npx -y -p node@22 -p npm@10 -c "npm run release:timeline-proof -- https://8223324090-production.up.railway.app"
```
