# TASK: Timeline Booking Details Canonical Interface Regression

- Status: implementation shipped for recovery rollback; canonical failure investigation remains open
- Type: investigation + fix task
- Production impact: yes
- Created: 2026-07-03

## Problem Summary

Clicking a timeline booking can open a fallback recovery modal instead of the
canonical Ukrainian booking details interface.

Observed wrong interface:
- title like `AH(60)`;
- row `Режим відкриття: Recovery після detail API`;
- diagnostic `TL-BK-DETAIL-RECOVERY-OPENED`;
- no event card image, no full activity fields, no edit/footer actions.

Expected interface:
- canonical `showBookingDetails(...)` modal from `js/booking.js`;
- full Ukrainian activity card, event image, `Дата`, `Час активності`,
  `Аніматори`, `Сценарій`, `Статус`, `Оновлено`;
- normal footer actions: edit, banquet sheet, more.

## Root Cause

The regression was introduced during the follow-up recovery release:

- Bad commit: `536699dbc` (`Release timeline recovery open fallback`)
- Version: `0.77.108`
- File: `js/timeline.js`
- New function: `timelineOpenRecoveredBookingDetails(...)`

That function writes directly to `#bookingDetails` and opens `#bookingModal`
from `js/timeline.js`. This bypasses the canonical booking details renderer in
`js/booking.js`.

The earlier diagnostic commits did not create the wrong interface by
themselves:

- `8ef8c7009` added visible `TL-BK-*` diagnostics.
- `00f3ba87f` added direct detail API probing and surfaced
  `TL-BK-DETAIL-OK-OPEN-FAILED`.
- `536699dbc` converted that diagnostic into a separate recovery UI, which is
  the wrong product behavior.

## Likely Underlying Bug Still To Find

`TL-BK-DETAIL-OK-OPEN-FAILED` means `/api/bookings/detail/:id` returned the
booking, but `showBookingDetails(...)` still did not open the canonical modal.

The recovery UI hid the real root cause. The next fix must inspect why
`showBookingDetails(...)` failed:

- exception inside the canonical renderer;
- missing frontend helper on the live asset combination;
- linked parent/child id path opening the wrong id first;
- stale Service Worker / mixed `booking.js` + `timeline.js` bundle;
- booking detail payload field mismatch after detail API fetch.

## Required Fix Direction

1. Remove the user-facing recovery renderer from `js/timeline.js`.
2. Keep diagnostics, but do not let timeline own the booking details UI.
3. Fix the canonical path so successful detail API data opens through
   `showBookingDetails(...)`.
4. If a final fallback is needed, it must call a canonical helper owned by
   `js/booking.js`, not write its own `#bookingDetails` markup.
5. Add a regression check that fails if `js/timeline.js` writes to
   `bookingDetails.innerHTML`, opens `bookingModal` as a details renderer, or
   contains `timelineOpenRecoveredBookingDetails`.

## Child Tasks

- `docs/TASK-timeline-remove-recovery-details-ui-2026-07-03.md` - remove the
  wrong timeline-owned recovery details UI from production code. Status:
  completed in `v0.77.109`.
- `docs/TASK-timeline-show-booking-details-root-cause-2026-07-03.md` - find and
  fix why canonical `showBookingDetails(...)` fails after a successful detail
  API hit. Status: open follow-up after authenticated live repro.
- `docs/TASK-booking-detail-source-of-truth-guard-2026-07-03.md` - add a static
  guardrail so timeline cannot own booking detail markup again. Status:
  completed as an MVP `test:ui` guard in `v0.77.109`.
- `docs/TASK-railway-live-booking-details-uat-2026-07-03.md` - verify the
  corrected flow on Railway after deploy. Status: pending deploy/live UAT.

## Protected Source-Of-Truth Fields

These are protected contracts for this bug family:

- booking identity: `id`, `linkedTo`, `linked_to`, `lineId`, `line_id`,
  `resourceId`, `resource_id`;
- timeline placement: `date`, `time`, `duration`, `room`, `status`;
- program/activity display: `programId`, `program_id`, `programName`,
  `program_name`, `programCode`, `program_code`, `label`;
- booking detail source: `/api/bookings/detail/:id`,
  `apiGetBookingById(...)`, `resolveBookingDetailsRecord(...)`,
  `showBookingDetails(...)`;
- modal ownership: `#bookingModal`, `#bookingDetails`.

Changing these field priorities, endpoint source, DB mapping, or detail modal
ownership requires explicit user approval before code edits.

## Guardrail To Implement

Add a static guard, preferably in `tests/ui-check.js` or a dedicated
`scripts/check-booking-detail-surface.js`, with these rules:

- `js/timeline.js` may call `showBookingDetails(...)`;
- `js/timeline.js` must not assign `bookingDetails.innerHTML`;
- `js/timeline.js` must not define a separate booking details modal renderer;
- `timelineOpenRecoveredBookingDetails` and
  `TL-BK-DETAIL-RECOVERY-OPENED` must not exist in production code;
- only canonical booking modules may own the details markup:
  `js/booking.js`, `js/booking-banquet-detail.js`,
  `js/booking-package-renderer.js`.

## Acceptance Criteria

- Clicking the same booking in both timeline positions opens the same canonical
  Ukrainian details modal.
- No operator-facing recovery modal is displayed for normal booking details.
- If canonical open fails, the toast shows a diagnostic code and console logs
  the exception, but the UI is not replaced with a parallel details interface.
- Static tests prevent reintroducing a timeline-owned details renderer.
- No DB schema, migration, seed data, auth, env, secrets, or production config
  changes are included.

## Suggested Verification

```bash
npx -y -p node@22 -p npm@10 -c "node --test tests/timeline-resources.test.js tests/booking-visibility.test.js tests/booking-drawer-encoding.test.js"
npx -y -p node@22 -p npm@10 -c "npm run test:ui"
npx -y -p node@22 -p npm@10 -c "npm test"
```

After deploy, perform authenticated live UAT:

1. Open the timeline on `2026-07-03`.
2. Click the `AH(60)` block.
3. Click the `+Вед(60): Додатковий ведучий` block.
4. Confirm both use the canonical full details modal, not recovery UI.
