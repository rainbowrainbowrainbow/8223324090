# Timeline Banquet Add-To-Existing UX Contract

Production impact: yes.

Date: 2026-06-24
Branch: `codex/timeline-leads-hardening`
Version at audit: `0.77.18 - Booking Detail Polish`

## Problem Summary

When a manager has a banquet selected on the room timeline and clicks an empty cell, the current UI can open a generic booking drawer. The drawer may visually look related to the same room/customer, but if the banquet group context is not explicitly carried into save, the new booking is created as standalone and does not become part of the banquet summary, package, menu totals, or mini banquet inspector.

Expected product behavior: while the user is working inside an existing banquet context, timeline creation should default to "add to this banquet". Creating a standalone booking must be an explicit user choice.

## Current Evidence

- `js/timeline.js`
  - `selectCell(cell)` calls `openBookingPanel(cell.dataset.time, cell.dataset.line)`.
  - `showTimelineBanquetInspector(...)` stores only `inspector.dataset.banquetGroupId`.
  - Timeline booking blocks carry `_timelineBanquetSummary`, but this context is not passed to empty-cell creation.
- `js/booking.js`
  - `openBookingPanel(time, lineId, options)` supports options, but empty-cell creation does not pass a banquet context.
  - room-first source lookup can infer context through `pickRoomBanquetSourceBooking(...)` and `apiGetBanquetByBooking(...)`, but this is heuristic.
  - `resetBookingDrawerStateForOpen(...)` clears selected banquet state unless it is rebuilt later.
- `js/booking-save-path.js`
  - `resolveBookingCreatePath(...)` correctly routes to existing group endpoints only when `selectedBookingBanquetGroupContext()` has a usable `groupId`.
- `routes/banquets.js`
  - Correct atomic endpoints already exist:
    - `POST /api/banquets/:groupId/member-booking`
    - `POST /api/banquets/:groupId/activity-booking`
    - `POST /api/banquets/from-source/member-booking`
    - `POST /api/banquets/from-source/activity-booking`
    - `POST /api/banquets/:groupId/bookings` for manual attach of an existing orphan booking.

## Definitions

### Active Banquet Context

An active banquet context is explicit UI state created by one of these sources:

- mini banquet inspector is open for a group;
- user clicked a room service marker or booking block with `_timelineBanquetSummary`;
- user opened details for a booking that belongs to a banquet group;
- user clicked an explicit "add to banquet" action.

Required context fields:

- `groupId`;
- `sourceBookingId` or `primaryBookingId`;
- `businessContext`;
- `date`;
- `customerId`;
- `customerName`;
- `room`;
- `groupName` or banquet number/label;
- `source` such as `timeline_banquet_inspector`, `timeline_banquet_block`, `booking_detail_add_action`;
- package/menu snapshot for display and safe prefill.

### Suggested Banquet Context

A suggested context is a heuristic match by same customer, room, date, or close time. It is useful for suggestions only. It must not silently attach a booking to a group without user confirmation.

### Standalone Booking

A standalone booking is a new booking with no banquet group membership. In active banquet context, standalone creation is allowed only after an explicit action such as `Створити окремо`.

## Entry Point Contract

| Entry point | Expected behavior | Context source | Default save path | Standalone rule |
| --- | --- | --- | --- | --- |
| Empty timeline cell, no active banquet | Create normal booking. | None. | `POST /api/bookings` or `/api/bookings/full` as today. | Default allowed. |
| Empty timeline cell, active banquet, same date/room | Open drawer in add-to-banquet mode. Prefill date/time/room/customer and show banquet context chip. | Active mini inspector or clicked banquet block summary. | Activity: `POST /api/banquets/:groupId/activity-booking`; kitchen/service/member: `POST /api/banquets/:groupId/member-booking`. | Only via explicit `Створити окремо`. |
| Empty timeline cell, active banquet, same date but different room | Ask or show clear banner: add to active banquet in another room vs create separately. | Active banquet context. | If user confirms add: group endpoint. | Explicit confirmation required. |
| Empty timeline cell, active banquet, different date/business context | Do not auto-attach. Show standalone drawer or ask to choose. | Context is stale for this cell. | Generic booking endpoint unless user selects a valid group. | Default standalone. |
| Toolbar "create booking", selected cell exists | Same as selected cell behavior. | Selected cell plus active banquet context if valid. | Same as empty-cell row. | Same as empty-cell row. |
| Toolbar "create booking", no selected cell but inspector open | Ask: add to active banquet or create standalone. | Active inspector context. | Group endpoint only after user confirms add. | Explicit choice. |
| Click banquet block/service marker | Open mini banquet inspector, not create drawer. | `_timelineBanquetSummary`. | No write. | Not applicable. |
| Mini inspector "Деталі" | Open full booking detail for carrier/primary booking. | Inspector summary. | No write. | Not applicable. |
| Mini inspector "Банкетний лист" | Open `booking-summary.html` with `groupId` and source booking id. | Inspector summary. | No write. | Not applicable. |
| Future mini inspector "Додати активність" | Open drawer in add-activity-to-banquet mode. | Inspector summary. | `POST /api/banquets/:groupId/activity-booking`. | Secondary `Створити окремо`. |
| Future mini inspector "Додати меню/кухню" | Open drawer in add-member-to-banquet mode with package/menu context. | Inspector summary. | `POST /api/banquets/:groupId/member-booking` with role `kitchen`. | Secondary `Створити окремо`. |
| Booking detail "Редагувати" | Edit existing booking only. | Existing booking id. | `PUT/PATCH` existing booking flow. | Must not create new booking. |
| Booking detail "Банкетний лист" | Open banquet summary for group. | Detail snapshot/group id. | No write. | Not applicable. |
| Booking detail "Додати бронь до банкету" candidate attach | Attach existing standalone/orphan booking after manual role choice. | Detail snapshot and candidate booking id. | `POST /api/banquets/:groupId/bookings`. | Not a create flow. |
| Generic booking form opened outside timeline | Create standalone booking. | None. | Generic booking endpoint. | Default allowed. |

## MVP UX Plan

### 1. Carry Explicit Active Context From Timeline

Add a lightweight active context in `js/timeline.js`:

- set it when `showTimelineBanquetInspector(...)` opens;
- include the full summary, not only `dataset.banquetGroupId`;
- clear it when inspector closes, date changes, business context changes, timeline view changes, or source bookings are refreshed;
- expose a helper like `getTimelineActiveBanquetContextForCell(cell)`.

`selectCell(cell)` should call:

```js
openBookingPanel(cell.dataset.time, cell.dataset.line, {
  banquetContext: getTimelineActiveBanquetContextForCell(cell),
  contextSource: 'timeline_empty_cell'
});
```

### 2. Preserve Context In Booking Drawer

`openBookingPanel(...)` / reset flow should preserve explicit `options.banquetContext` before room heuristics run.

Required drawer state:

- `BookingDrawerState.roomSelectionBanquetContext`;
- `BookingDrawerState.selectedBanquetGroupId`;
- `BookingDrawerState.manualBanquetGroupSelection = false`;
- `BookingDrawerState.autoFilledBanquetFromRoom`;
- `BookingDrawerState.activeBanquetIntent = 'add_to_existing'`.

Heuristic room lookup may still run, but it must not override explicit context unless the explicit context is stale or user changes it.

### 3. Show Visible Context Banner

When drawer is opened from active banquet context, show a compact banner/chip near the top:

Text:

`Додається до банкету: №/назва, клієнт, кімната, дата`

Actions:

- `Змінити банкет` opens existing banquet selector;
- `Створити окремо` clears `selectedBanquetGroupId`, clears active banquet intent, and switches to standalone mode;
- if user changes customer and it no longer matches group customer, block save until they confirm standalone or select another group.

### 4. Prefill Values

Always prefill from clicked cell:

- date;
- time;
- room/line.

Always prefill from active banquet context:

- customer;
- group id;
- source booking id;
- visible banquet label;
- kids/adults/table snapshots if available;
- package/menu summary.

For kitchen/member mode:

- show existing package/menu values as the starting package context;
- allow editing only through the package controls;
- save through member endpoint with role `kitchen` or chosen role.

For activity mode:

- show package/menu context as read-only summary unless kitchen is enabled;
- do not copy menu positions into an activity booking unless user explicitly enables kitchen/member fields;
- save through activity endpoint.

### 5. Role Selection Rules

Default role can be inferred from form state:

- selected event/program/activity -> `activity`;
- kitchen/menu/package fields enabled without activity -> `kitchen`;
- service-only manual operation -> `service`;
- unclear form state -> ask user with a small segmented control: `Активність`, `Кухня/сервіс`, `Окремо`.

The role must be visible before save. Silent fallback to generic booking is not allowed while `activeBanquetIntent = 'add_to_existing'`.

### 6. Save Rules

If active banquet context is valid and standalone override is not active:

- activity role -> `apiCreateBanquetActivityBooking(groupId, { sourceBookingId, booking, linkedBookings })`;
- kitchen/service/member role -> `apiCreateBanquetMemberBooking(groupId, { sourceBookingId, role, booking })`.

If source booking id is missing:

- block save with clear error;
- reload group snapshot by `groupId`;
- only continue after primary/source booking is resolved.

If user explicitly selects standalone:

- clear banquet group fields from payload;
- use generic create path;
- show confirmation when clicked cell overlaps or sits near active banquet.

## Narrow/Mobile Behavior

- Context banner should be sticky under the drawer header.
- Chips must wrap; long client names and banquet labels must not overflow.
- `Створити окремо` should be secondary, not the primary button.
- If space is tight, put `Змінити банкет` and `Створити окремо` into a small action menu.
- Confirmation copy should be short:
  - `Ця дія створить окреме бронювання, не в банкеті. Продовжити?`

## Safety Rules

- Same customer + same room + close time is not durable proof. It can only show a suggestion.
- Active banquet context must include `groupId`.
- Adding to a group must preserve `businessContext`.
- Customer mismatch must block save or force explicit standalone.
- Room mismatch must not block a valid banquet add, but it must be visible as "інша кімната цього банкету".
- Generic `/api/bookings` must not be used when active add-to-banquet intent is valid.
- Do not auto-attach existing orphan bookings. Use manual review and `POST /api/banquets/:groupId/bookings`.

## Affected Files For Implementation

- `js/timeline.js`
  - store active banquet context;
  - pass context through `selectCell(...)`;
  - clear stale context on close/date/view reload;
  - optional mini inspector add buttons.
- `js/booking.js`
  - accept `options.banquetContext` in `openBookingPanel(...)`;
  - preserve explicit group context through reset;
  - render context banner/chip;
  - implement explicit standalone override;
  - prefill package/menu/customer values.
- `js/booking-banquet-selector.js`
  - render selected context from explicit timeline source;
  - support change/clear actions without losing dirty form state.
- `js/booking-save-path.js`
  - treat valid active banquet context as binding intent;
  - block save if context exists but source booking id is missing;
  - avoid silent fallback to `normal_booking`.
- `tests/timeline-resources.test.js`
  - empty-cell click with active banquet passes context.
- `tests/booking-package-contract.test.js`
  - package/menu context is preserved for add-to-existing.
- `tests/ui-check.js`
  - banner/chip and standalone action static guards.

## Regression Coverage Plan

Automated:

- empty cell with no active banquet opens normal create;
- empty cell with active mini inspector opens add-to-banquet mode;
- same customer/room heuristic without explicit context shows suggestion, not silent attach;
- `Створити окремо` clears group context and uses generic create;
- activity form with active group uses `activity-booking`;
- kitchen/menu form with active group uses `member-booking`;
- missing `sourceBookingId` blocks add-to-group save;
- customer mismatch blocks or forces explicit standalone;
- mobile/narrow banner does not overflow static guard.

Manual:

- banquet with menu + activity + food marker;
- click 15:15 in same room while inspector is open;
- confirm drawer says "Додається до банкету";
- save new activity and verify it appears in mini inspector and banquet sheet;
- create standalone explicitly and verify it is separate by design;
- repeat on narrow viewport.

## Recommended Implementation Order

1. Add active banquet context helper in `js/timeline.js`.
2. Pass context from empty-cell click to `openBookingPanel(...)`.
3. Preserve explicit context in drawer state and render banner.
4. Add standalone override action.
5. Harden `resolveBookingCreatePath(...)` against silent generic fallback.
6. Add tests for context propagation and save path.
7. Manual QA on the screenshot scenario.
