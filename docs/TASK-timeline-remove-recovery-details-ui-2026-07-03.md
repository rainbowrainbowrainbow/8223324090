# TASK: Remove Timeline-Owned Booking Details Recovery UI

- Status: completed in `v0.77.109`
- Type: hotfix implementation task
- Production impact: yes
- Parent: `docs/TASK-timeline-booking-details-canonical-interface-2026-07-03.md`
- Bad release to fix: `0.77.108`
- Bad commit: `536699dbc` (`Release timeline recovery open fallback`)

## Goal

Remove the operator-facing recovery booking details interface from
`js/timeline.js` so timeline clicks can no longer replace the canonical booking
details modal with a parallel renderer.

## Problem

The live site currently opens a modal with:

- `Режим відкриття: Recovery після detail API`
- `TL-BK-DETAIL-RECOVERY-OPENED`
- missing event card image;
- missing full activity fields;
- missing normal edit/footer actions.

This is not the accepted product interface. It is a recovery UI introduced in
`js/timeline.js`, not the canonical renderer from `js/booking.js`.

## Scope

- Remove `timelineOpenRecoveredBookingDetails(...)` from `js/timeline.js`.
- Remove `timelineBookingRecoveryTitle(...)` and
  `timelineBookingRecoveryEndTime(...)` if they only support the recovery UI.
- Remove the branch that opens recovery details when detail probe returns a
  booking.
- Keep diagnostic codes if useful, but they must not render a second booking
  details interface.
- Update tests that currently assert `TL-BK-DETAIL-RECOVERY-OPENED`.

## Non-Goals

- Do not change database schema, migrations, seed data, auth, env, secrets, or
  Railway settings.
- Do not change `/api/bookings/detail/:id` contract.
- Do not change booking identity or field priority without explicit approval.
- Do not create another fallback details renderer in another file.

## Acceptance Criteria

- `js/timeline.js` does not contain `timelineOpenRecoveredBookingDetails`.
- Production code does not contain `TL-BK-DETAIL-RECOVERY-OPENED`.
- Timeline click helper calls `showBookingDetails(...)` and can collect
  diagnostics, but does not write `#bookingDetails` markup itself.
- If canonical details fail, the UI shows a diagnostic toast rather than a fake
  details card.

## Implementation Result

- `timelineOpenRecoveredBookingDetails(...)`,
  `timelineBookingRecoveryTitle(...)`, and
  `timelineBookingRecoveryEndTime(...)` were removed from `js/timeline.js`.
- Detail probe diagnostics no longer carry the booking payload.
- `tests/timeline-resources.test.js` now verifies that a successful detail API
  hit without canonical modal open returns `TL-BK-DETAIL-OK-OPEN-FAILED`
  instead of rendering recovery UI.
- `tests/ui-check.js` prevents reintroducing a timeline-owned details renderer.

## Suggested Verification

```bash
npx -y -p node@22 -p npm@10 -c "node --test tests/timeline-resources.test.js"
npx -y -p node@22 -p npm@10 -c "npm run test:ui"
npx -y -p node@22 -p npm@10 -c "npm test"
```

After deploy, confirm the live site no longer shows
`Recovery після detail API` for booking details.
