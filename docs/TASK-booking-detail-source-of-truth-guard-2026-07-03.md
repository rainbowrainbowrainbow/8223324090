# TASK: Add Booking Detail Source-Of-Truth Guardrail

- Status: MVP completed in `v0.77.109`; stronger allowlist remains optional follow-up
- Type: automated guardrail task
- Production impact: yes
- Parent: `docs/TASK-timeline-booking-details-canonical-interface-2026-07-03.md`

## Goal

Add an automated check that prevents future changes from moving booking details
ownership out of the canonical booking modules or changing protected booking
source fields without an explicit review trail.

## Protected Ownership Contract

Canonical owners:

- `js/booking.js`
- `js/booking-banquet-detail.js`
- `js/booking-package-renderer.js`

Non-owners:

- `js/timeline.js`
- page scripts outside booking modules
- temporary diagnostic/recovery helpers

`js/timeline.js` may call `showBookingDetails(...)`, but it must not render
booking details markup itself.

## Protected Fields And Sources

Protected fields:

- `id`, `linkedTo`, `linked_to`
- `lineId`, `line_id`
- `resourceId`, `resource_id`
- `date`, `time`, `duration`, `room`, `status`
- `programId`, `program_id`
- `programName`, `program_name`
- `programCode`, `program_code`
- `label`

Protected sources:

- `/api/bookings/detail/:id`
- `apiGetBookingById(...)`
- `resolveBookingDetailsRecord(...)`
- `showBookingDetails(...)`
- `#bookingModal`
- `#bookingDetails`

## Implementation Options

Recommended MVP:

- Add a static assertion to `tests/ui-check.js`, or create
  `scripts/check-booking-detail-surface.js` and wire it into `npm test`.
- Fail if `js/timeline.js` contains:
  - `bookingDetails.innerHTML`;
  - `getElementById('bookingDetails')` combined with `innerHTML`;
  - `timelineOpenRecoveredBookingDetails`;
  - `TL-BK-DETAIL-RECOVERY-OPENED`;
  - direct assignment that opens `bookingModal` as a details renderer.

Stronger follow-up:

- Create a small allowlist of files that may assign booking details markup.
- Require a visible approval marker in task docs for changes to protected
  fields or source priority.

## Acceptance Criteria

- `npm test` fails if timeline introduces a parallel booking details renderer.
- `npm test` fails if `TL-BK-DETAIL-RECOVERY-OPENED` appears in production code.
- The guardrail documents the canonical owners and protected fields.
- Existing canonical booking renderers still pass.

## Implementation Result

- `tests/ui-check.js` includes `Timeline booking detail modal rendering stays
  owned by booking.js`.
- The guard checks that `js/timeline.js` does not include
  `timelineOpenRecoveredBookingDetails`, `TL-BK-DETAIL-RECOVERY-OPENED`,
  `getElementById('bookingDetails')`, `bookingDetails.innerHTML`, or
  `booking-detail-row`.
- `AGENTS.md` now records the approval rule for protected booking detail
  fields, source endpoints, and modal ownership.

## Suggested Verification

```bash
npx -y -p node@22 -p npm@10 -c "npm run test:ui"
npx -y -p node@22 -p npm@10 -c "npm test"
```

## Approval Rule

Changing protected field priority, endpoint source, DB mapping, or modal
ownership requires explicit user approval before code edits. This is a product
and data-source contract, not a normal refactor.
