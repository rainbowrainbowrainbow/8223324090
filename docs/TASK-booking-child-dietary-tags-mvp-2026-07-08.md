# Task: Booking Child Dietary Tags MVP - Pending Approval

## Goal

Decide and, only after explicit approval, implement a small structured dietary signal for customer children so kitchen-relevant restrictions are visible without relying only on free-text `children.note`.

## Current Status

- `children.note` remains the source for child free-text context.
- Booking drawer shows child notes and kitchen-important notes.
- `bookingNotes` is multiline and kitchen note copy is explicit/idempotent.
- Read-only discovery tooling exists:
  - `npm run audit:child-dietary-notes -- --business-context=event_genix --limit=500`
- The first local audit attempt was blocked by unavailable DB connection and did not read production child notes.

## Prerequisite Gate

Do not implement schema changes until all are true:

1. Aggregate audit has been run in an environment with DB access.
2. Counts show recurring food-safety or dietary-restriction notes.
3. Product owner approves structured dietary data.
4. Migration plan and rollback are reviewed.

## Recommended MVP

If approved, prefer dietary tags on child records plus the existing free-text note:

- keep `children.note` unchanged;
- add structured dietary tags for common kitchen signals;
- optionally add a short `dietary_note` only if tags are not enough;
- show tags above free-text notes in booking customer context;
- include tags in `Важливо для кухні`;
- keep `Додати в примітки кухні` explicit, not automatic.

## Suggested Tag Set

Start small:

- `nuts`;
- `lactose`;
- `gluten`;
- `eggs`;
- `sugar`;
- `dyes`;
- `other`;
- `allergy_confirmed`.

Avoid medical-grade severity workflows until operators confirm they need them.

## Implementation Scope If Approved

- DB migration with governance headers.
- `services/customerChildren.js` validation and projection.
- `routes/customers.js` create/update/search mapping.
- Customer edit UI for tags.
- Booking drawer display and kitchen context rendering.
- Tests for API mapping, UI render, kitchen copy, and backward compatibility.
- Live smoke with disposable customer containing tags and free-text note.

## Done When

- Existing children without tags still render from `children.note`.
- Tagged children show dietary badges in customer context.
- Kitchen context prioritizes structured tags above free text.
- No automatic write into booking notes occurs without clicking the kitchen action.
- Migration, rollback note, CI, and live smoke are complete.

## Risks

- Schema migration can affect customer edit/search flows.
- Tags can create false confidence if operators do not maintain them.
- Backfill from free text should not be automatic without human review.
- Raw production notes must not be copied into tickets, commits, or release notes.
