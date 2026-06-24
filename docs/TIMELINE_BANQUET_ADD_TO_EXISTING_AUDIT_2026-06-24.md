# Timeline Banquet Add-To-Existing Audit

Production impact: yes.

Date: 2026-06-24
Branch: `codex/timeline-leads-hardening`
Version at audit: `0.77.18 - Booking Detail Polish`

## Symptom

When a manager works with an existing banquet on the room timeline and clicks an empty timeline cell, the booking drawer opens as a generic new booking flow. The form may pull the same customer from the room, but it does not reliably preserve the existing banquet group context. After save, the new record can be created as a standalone booking, shown as a separate gray card such as `Наталія Войтенко`, instead of becoming a member of the existing banquet with its menu/package totals.

Expected behavior: when the active context is an existing banquet, the create drawer should clearly open in "add to this banquet" mode, prefill the relevant banquet/customer/package context, and save through the atomic banquet endpoints.

## Preflight Evidence

- `git status --short --branch`: branch is `codex/timeline-leads-hardening`, dirty worktree contains unrelated customer/children files.
- `npm run check:runtime`: passed on Node `22.23.0` / npm `10.9.8`.
- `npm run version:current`: `v0.77.18 - Booking Detail Polish`, upstream in sync, dirty worktree.
- No production data was changed.

## Reproduction Path

Use local or staging data only.

1. Create or find a banquet group with:
   - room, for example `Диван 3`;
   - customer, for example `Наталія Войтенко`;
   - an activity, for example `15:00 Мафія(90)`;
   - kitchen/menu member, for example `16:30 Видача / Кухня 1 поз.`;
   - `banquet_group_id` and membership rows.
2. Open the room timeline.
3. Open or select the mini banquet inspector for that banquet.
4. Click an empty timeline cell in the same room/time area, for example `15:15` or `17:00`.
5. Observe the booking drawer.
6. If the drawer is saved through the generic flow, the created booking appears as a separate standalone card and is not included in the banquet summary/menu/package totals.

Important distinction:

- Correct flow: save uses `/api/banquets/:groupId/member-booking` or `/api/banquets/:groupId/activity-booking`.
- Broken flow: save uses `/api/bookings` or `/api/bookings/full` without a durable banquet group endpoint.

## Root Cause

The issue is primarily frontend state/intent loss.

`js/timeline.js` calls `openBookingPanel(time, lineId)` directly from an empty cell:

- `selectCell(cell)` calls `openBookingPanel(cell.dataset.time, cell.dataset.line)`.
- It does not pass the active mini banquet inspector summary, `banquetGroupId`, source booking id, customer id, or package/menu snapshot.

`js/booking.js` then resets drawer state on open:

- `openBookingPanel()` calls `resetBookingDrawerStateForOpen(...)`.
- `resetBookingDrawerStateForOpen()` clears `roomSelectionBanquetContext`, `roomBookingAnimationBridge`, `selectedBanquetGroupId`, and banquet selector candidates.

After reset, the drawer tries to reconstruct context indirectly:

- room-first mode sets `roomSelect` from the clicked line;
- `prefillRoomFirstCustomerFromRoomLine()` can hydrate only customer data from a nearby room booking;
- `initializeRoomFirstBookingSourceContext()` calls `handleBookingRoomSelectionContextChange()`;
- `handleBookingRoomSelectionContextChange()` uses `pickRoomBanquetSourceBooking(room, time)` and then `apiGetBanquetByBooking(sourceBooking.id)`.

This is heuristic, not explicit intent. It can fail or select the wrong source if:

- the clicked time is outside the source booking interval;
- more than one booking exists in the same room;
- a newly-created standalone booking is now closer by time than the real banquet source;
- the visible source booking has customer data but no resolved `banquetGroupId`;
- the active mini inspector had the correct group, but that group was not passed into the drawer.

When the context is missing, `resolveBookingCreatePath()` returns the normal path:

- no `groupId` means `normal_booking` or `full_booking`;
- `apiCreateBooking()` creates a standalone row;
- `apiCreateBookingFull()` explicitly rejects banquet group payloads, so it is not the correct fallback for group membership.

## Correct Backend Path

The backend already has the correct atomic endpoints:

- `POST /api/banquets/:groupId/member-booking`
- `POST /api/banquets/:groupId/activity-booking`
- `POST /api/banquets/from-source/member-booking`
- `POST /api/banquets/from-source/activity-booking`

These endpoints call `services/banquetGroups.js` and insert:

- the booking row;
- `banquet_group_bookings` membership;
- compatibility link;
- package/entry charge calculations;
- banquet history.

The generic `/api/bookings` insert does not create a banquet membership. That is why the standalone gray card is structurally separate.

## Payload Diff

Broken standalone payload shape:

```json
{
  "date": "2026-06-24",
  "time": "15:15",
  "lineId": "banquet-service",
  "room": "Диван 3",
  "customerId": 101,
  "extraData": {
    "bookingWorkspace": {}
  }
}
```

Correct add-to-existing payload shape:

```json
{
  "sourceBookingId": "BK-2026-0502",
  "role": "kitchen",
  "booking": {
    "date": "2026-06-24",
    "time": "15:15",
    "lineId": "banquet-service",
    "room": "Диван 3",
    "customerId": 101,
    "extraData": {
      "banquetGroup": {
        "groupId": "BQ-2026-0001",
        "sourceBookingId": "BK-2026-0502",
        "role": "kitchen",
        "source": "timeline_active_banquet_context"
      },
      "bookingPackage": {
        "menuPositions": [],
        "entryCharge": {}
      }
    }
  }
}
```

For an activity member the endpoint should be `/api/banquets/:groupId/activity-booking`, with role `activity`.

## Canonical Grouping Rules

Source of truth:

- `banquet_groups.id`
- `banquet_group_bookings.group_id`
- `banquet_group_bookings.booking_id`
- role in `banquet_group_bookings.role`

Compatibility/context fields:

- `extra_data.banquetGroup.groupId`
- `extra_data.banquetGroup.sourceBookingId`
- `extra_data.banquetGroup.role`
- legacy compatibility links where present

Required when adding a booking to an existing banquet:

- `groupId`
- `sourceBookingId` or primary booking id;
- role: `kitchen`, `activity`, `service`, or explicit supported role;
- same `business_context`;
- validated customer compatibility;
- room/date context;
- package/menu payload if adding kitchen/member booking.

Do not treat same customer + same room + close time as durable proof. That is useful for suggestions only.

## Affected Files

Frontend:

- `js/timeline.js`
  - `selectCell()`
  - mini banquet inspector state
  - `_timelineBanquetSummary`
  - `data-banquet-group-id`
- `js/booking.js`
  - `openBookingPanel()`
  - `prefillRoomFirstCustomerFromRoomLine()`
  - `initializeRoomFirstBookingSourceContext()`
  - `handleBookingRoomSelectionContextChange()`
  - `pickRoomBanquetSourceBooking()`
  - save flow around `resolveBookingCreatePath()`
- `js/booking-banquet-selector.js`
  - selected banquet context
  - candidate selector
  - virtual source bridge state
- `js/booking-save-path.js`
  - `resolveBookingCreatePath()`
  - correct endpoint selection

Backend:

- `routes/banquets.js`
  - existing atomic endpoints are the correct target
- `services/banquetGroups.js`
  - membership creation and package/entry charge handling
- `routes/bookings.js`
  - generic endpoints must remain non-grouping unless explicitly passed through atomic banquet flow

Tests:

- `tests/booking-package-contract.test.js`
- `tests/booking-banquet-links.test.js`
- `tests/timeline-resources.test.js`
- `tests/ui-check.js`

## Recommended Fix Strategy

1. Add explicit active banquet context in the timeline.
   - When mini inspector opens, store a lightweight active context:
     - `groupId`;
     - `primaryBookingId` / `sourceBookingId`;
     - `customerId`;
     - `room`;
     - `date`;
     - `summary`;
     - `carrierBooking`.
   - Clear it when inspector closes, date changes, business context changes, or timeline reload invalidates it.

2. Pass that context into `openBookingPanel()` from `selectCell()`.
   - Example option: `openBookingPanel(time, lineId, { activeBanquetContext })`.
   - `resetBookingDrawerStateForOpen()` should accept a preserve/seed option for active banquet context instead of blindly losing it.

3. Seed the booking drawer from explicit context before heuristic room lookup.
   - Set `BookingDrawerState.roomSelectionBanquetContext`.
   - Set `BookingDrawerState.selectedBanquetGroupId`.
   - Prefill customer from context.
   - Prefill room/date.
   - Show a visible chip/banner: `Додається до банкету ...`.

4. Keep heuristic room lookup only as fallback.
   - `pickRoomBanquetSourceBooking()` can still suggest context when no inspector is active.
   - It must not override explicit active context.

5. Force explicit standalone intent.
   - If active banquet context exists, default save should be add-to-existing.
   - To create standalone, user should choose an explicit `Створити окремо` action.

6. Save through atomic endpoints.
   - Existing group + kitchen/member: `/api/banquets/:groupId/member-booking`.
   - Existing group + activity: `/api/banquets/:groupId/activity-booking`.
   - Source-only bridge: `/api/banquets/from-source/...`.
   - Generic `/api/bookings` only when no active/selected banquet context exists or user explicitly chooses standalone.

## Regression Coverage Plan

Add guards for:

- Empty timeline cell click while mini inspector is open seeds `selectedBanquetGroupId`.
- Drawer shows active banquet context chip before save.
- Saving kitchen/member with active banquet context calls `apiCreateBanquetMemberBooking`.
- Saving activity with active banquet context calls `apiCreateBanquetActivityBooking`.
- Generic `apiCreateBooking` is not used while active banquet context exists, unless explicit standalone mode is selected.
- Existing room heuristic still works when no mini inspector is open.
- New booking appears in `banquet_group_bookings` after reload.
- Menu/package totals include the new member.
- Standalone booking remains possible only through explicit standalone choice.

## Open Risk

Existing production data may already contain orphan bookings created by this UX gap. That should be handled by a separate read-only inventory and manual repair task. Do not auto-merge old records based only on same customer/time/room.
