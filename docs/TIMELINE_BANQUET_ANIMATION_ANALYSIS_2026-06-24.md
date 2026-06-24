# Timeline Banquet Animation Analysis - 2026-06-24

Production impact: yes.

## Symptom

In room timeline, an activity/animation that starts a banquet group can disappear after food/kitchen service is added to the same banquet. The screenshots show the room row keeping the food marker (`Кухня 6 поз.`, `Видача 14:00`) while the related animation block is no longer visible.

## Preflight

- Branch: `codex/timeline-leads-hardening`
- Local release: `v0.77.13 - Timeline Animation Visibility Fix`
- Runtime check: Node `22.23.0`, npm `10.9.8`
- Worktree was dirty before analysis with unrelated customer/children changes; those files were not edited by this analysis.

## Reproduction Evidence

Local DOM harness using current `js/timeline.js` reproduced the issue without production data:

```json
{
  "markerCount": 1,
  "primaryActivity": {
    "role": "primary",
    "hiddenClass": true,
    "ariaHidden": "true",
    "hasPreviewTrigger": true
  },
  "kitchen": {
    "role": "kitchen",
    "hiddenClass": true,
    "ariaHidden": "true"
  },
  "lineLayout": {
    "operationalLanes": "2",
    "minHeight": "154px"
  }
}
```

Control scenario where the same animation is a normal `activity` member stays visible:

```json
{
  "markerCount": 1,
  "primary": {
    "role": "primary",
    "hiddenClass": true
  },
  "activity": {
    "role": "activity",
    "hiddenClass": false,
    "ariaHidden": null
  }
}
```

## Root Cause

This is a frontend preview-role bug, not a backend projection or row-height bug.

The API already returns the relevant room timeline rows:

- activity/animation: `timelineProjection.displaySurface = "booking_block"`
- kitchen/food root: `timelineProjection.displaySurface = "service_marker"`

The activity reaches the DOM. It disappears only after banquet preview hydration adds service markers and calls:

- `applyTimelineBanquetPreview()`
- `timelineBanquetPreviewRoleForTarget()`
- `applyTimelineBanquetGridPreviewVisuals()`
- `timelineBanquetPreviewRoleUsesGridDuplicateHide()`

For an activity-first banquet group, the animation booking is also the `primary_booking_id`. `timelineBanquetPreviewRolesByBookingId()` assigns it visual role `primary`. Then `timelineBanquetPreviewRoleUsesGridDuplicateHide()` hides all `primary/root/banquet` roles when service markers exist. CSS completes the disappearance:

```css
.booking-block.is-timeline-banquet-grid-duplicate {
    display: none !important;
    pointer-events: none;
}
```

So the activity is not lost by API, matching, or sizing. It is intentionally hidden by duplicate-grid preview logic, but that rule is too broad for an animation that happens to be the primary booking of the banquet group.

## Why Size Is Not The Main Cause

The reproduced row gets `--timeline-line-min-h: 154px` and `data-room-operational-lanes="2"`, so operational lane reservation is working. Existing `syncTimelineRoomOperationalLayout()` separates the service marker and activity card when the activity has visual role `activity`.

The disappearing case is caused by `display: none !important`, not by `height: 0`, `overflow: hidden`, or z-index.

## Affected Files

- `js/timeline.js`
  - `timelineBanquetPreviewRolesByBookingId`
  - `timelineBanquetPreviewRoleForTarget`
  - `timelineBanquetPreviewRoleUsesGridDuplicateHide`
  - `applyTimelineBanquetGridPreviewVisuals`
- `css/timeline.css`
  - `.booking-block.is-timeline-banquet-grid-duplicate`
  - room activity/service marker layout rules
- `tests/timeline-resources.test.js`
  - add regression for activity-first primary animation staying visible when service markers exist
- `tests/booking-banquet-links.test.js`
  - existing API coverage is useful, but it does not catch this DOM hiding issue

## Existing Coverage Gap

Focused checks passed:

- `POST banquet source member-booking exposes final activity-first timeline payload`
- `POST banquet source activity-booking exposes final kitchen-first timeline payload`
- `room timeline hides duplicate banquet grid blocks when service markers exist`
- `room operational lanes separate same-time service marker and activity block`
- `room timeline banquet activity blocks keep full booking modal click ownership`

The missing guard is: activity-first primary booking must not be treated as a duplicate banquet/root block when it is an actual animation/activity card.

## Safe Fix Plan

1. Add a helper that distinguishes visual activity blocks from true banquet/kitchen/root duplicates.
   - Example: primary booking with category `animation`, `show`, `quest`, `masterclass`, `pinata`, `photo`, `custom`, etc. should use visual role `activity`.
   - True `banquet`, kitchen/service root, and kitchen role can still be hidden when service markers exist.

2. Update `timelineBanquetPreviewRoleForTarget()` or `applyTimelineBanquetGridPreviewVisuals()` so activity-first primary bookings keep visible activity-card behavior.
   - Do not change database roles.
   - Do not change `banquet_groups.primary_booking_id`.
   - Only change frontend visual role/hide decision.

3. Preserve click behavior.
   - Activity cards should keep booking modal click ownership.
   - Banquet/kitchen/root duplicates should still open the banquet inspector through service markers/header preview.

4. Keep operational lane layout.
   - After service markers render, `syncTimelineRoomOperationalLayout()` should still place food marker and activity in separate lanes if they overlap.

5. Add regression tests.
   - Activity-first primary animation + food marker: activity block remains visible.
   - Kitchen-first + activity: existing behavior remains visible.
   - True banquet root + food marker: root duplicate can still be hidden.
   - Same-time food marker + activity: no overlap/clipping; row height grows.

## Verification Plan For Fix

- `node --test --test-name-pattern "activity-first|room timeline hides duplicate banquet grid blocks|room operational lanes" tests/timeline-resources.test.js tests/booking-banquet-links.test.js`
- `node --test tests/timeline-resources.test.js`
- `node --test tests/booking-banquet-links.test.js`
- `npm run test:ui`
- `npm test`
- Manual QA:
  - create activity-first banquet;
  - add food/kitchen serving marker;
  - confirm animation remains visible in `Кімнати`;
  - switch to `Аніматори`;
  - hard reload;
  - confirm no duplicate root/kitchen blocks appear.
