# Room Domain Contract

Date: 2026-07-17
Status: implemented durable room identity contract.
Production impact: yes.

## Decision

`timeline_resources` rows with `type = 'room'` are the canonical catalog of physical rooms.

The park room feature still has legacy text fields, so this contract separates durable identity from display snapshots:

- `timeline_resources.resource_id` is the stable technical room identity.
- `timeline_resources.name` is the current operator-facing room name.
- `timeline_resources.short_name` is a display helper only.
- `timeline_resources.metadata.aliases` holds old names and other accepted legacy labels.
- `bookings.room_resource_id` is the canonical booking room identity.
- `banquet_groups.room_resource_id`, `booking_templates.room_resource_id`, and
  `recurring_templates.room_resource_id` carry the same durable identity.
- The corresponding `room` fields remain display/legacy snapshots and are not deleted.

Do not create a new abstract room subsystem. Extend the existing timeline resource model and existing booking flows incrementally.

## Room Types

Physical room:

- Exists as one active or inactive `timeline_resources` row with `type = 'room'`.
- Can be selected for new bookings only when `is_active = true`.
- Must keep the same `resource_id` across rename, recolor, reorder, and settings edits.

Takeaway:

- `На виніс` is a virtual room resource, currently represented by `room-takeaway`.
- It is not a physical room.
- It must not reserve room capacity, block physical room conflict checks, or appear as an inactive/unknown room.
- It may stay selectable where the room-first business flow needs it.

Other:

- `Інше` is not a physical room.
- New room-timeline bookings should not use `Інше` once the room catalog UI is resource-backed.
- Legacy `Інше` bookings are not deleted or silently remapped.
- Legacy `Інше` rows should appear through a controlled quarantine/repair flow when they need operator attention.

Quarantine:

- `room-quarantine` is a virtual, non-assignable diagnostic row.
- It exists to display bookings whose room identity cannot be safely assigned to an active physical room.
- It is not selectable for new bookings.
- It should be rendered only when at least one booking on the visible date/range actually resolves to quarantine.

## Lifecycle Rules

Create:

- New room-timeline bookings should select an active physical room resource or the virtual takeaway option.
- Until `room_resource_id` exists, the server may continue to persist `bookings.room` as the selected room name.
- The UI must not offer inactive physical rooms for new bookings.
- The UI should not offer `Інше` for new room-timeline bookings after catalog consolidation.

Edit:

- Existing bookings with active room names stay editable.
- Existing bookings with legacy aliases, inactive rooms, blank room, or custom room values must stay visible enough to repair.
- Editing a legacy/problem booking should allow the operator to choose an active physical room.

Duplicate:

- Duplicate flow should preserve the source room when it is valid.
- If the source room is inactive, unknown, blank, or `Інше`, the duplicate flow should force an explicit active room or takeaway choice before save.

Rename:

- `resource_id` never changes.
- `name` changes to the new display name.
- The old `name` and old `short_name` are added to `metadata.aliases`.
- Old bookings using the old text continue to resolve to the same room resource through aliases.
- Conflict checks remain text-sensitive until durable booking room ids are approved, so aliases alone are not enough for full rename safety.

Deactivate:

- Deactivation means `is_active = false`; do not delete the resource.
- Inactive rooms are hidden from new booking selection.
- Old bookings tied to inactive rooms remain visible and repairable.
- Room timeline resolves them to quarantine with an inactive-room diagnostic unless a future repair flow explicitly displays them under a dedicated inactive-room state.

Unknown legacy room:

- Unknown non-empty room text that cannot match `resource_id`, `name`, `short_name`, or `aliases` resolves to quarantine.
- The booking must never fall into the first physical room row or the takeaway row.

## Legacy Compatibility Rules

- New and edited park bookings must carry a validated `room_resource_id`.
- The backend derives the canonical display `room` name and does not trust arbitrary
  frontend room text.
- Conflict, lock and availability identity use `room_resource_id` first.
- Name/short-name/unique-alias fallback applies only to legacy rows with a `NULL` ID.
- Operational room lists come from active `timeline_resources(type='room')`;
  `ALL_ROOMS` and static HTML options are not catalog sources.
- Legacy unresolved rows stay visible through quarantine and are never remapped to
  takeaway or the first physical room.

## Regression Matrix

| Scenario | Contract expectation | Current/future coverage |
|---|---|---|
| Create room booking | Active physical room or takeaway only; no inactive room selection. | Characterize current non-empty text behavior, then cover resource-backed selection. |
| Edit booking | Existing valid room remains editable; problem room can be repaired. | Cover active room edit and legacy/problem repair path before UI change. |
| Duplicate booking | Valid source room can carry over; invalid source room requires explicit choice. | Add characterization before disabling `Інше`/inactive choices. |
| Availability | Free-room list uses the same active room catalog as timeline. | Implemented through active `timeline_resources(type='room')`; `ALL_ROOMS` was removed. |
| Strict room conflict | Unrelated overlapping physical room bookings conflict. | Covered by focused room conflict tests. |
| Same-banquet overlap | Kitchen/service and activity overlap in the same banquet can be allowed by policy. | Covered by existing same-banquet room policy tests. |
| Takeaway | Does not block physical rooms and never resolves to quarantine. | Covered by existing takeaway room tests. |
| Rename | Same `resource_id`; old name becomes alias; old bookings resolve. | Resolver has alias behavior; add catalog-management test when rename UI/API is changed. |
| Deactivate | Not selectable for new bookings; old bookings remain visible/repairable. | Resolver quarantines inactive rooms; add UI selection test when catalog UI changes. |
| Unknown legacy room | Goes only to quarantine with diagnostic reason. | Covered by resolver/render fallback tests. |
| Empty quarantine | Quarantine line is not rendered when no problem bookings exist. | Needed for the immediate UX fix. |
| Non-empty quarantine | Quarantine line renders when at least one booking resolves there. | Needed for the immediate UX fix. |

## Criteria For Durable Room IDs

Move to `room_resource_id` when at least one of these becomes product-critical:

- room rename must be conflict-safe without rewriting old booking text;
- inactive-room repair must distinguish historical identity from current display name;
- room settings become operator-managed in production;
- availability and conflict checks must survive aliases and localization changes;
- reporting needs stable physical-room history independent of display names.

Minimum durable-id migration rules:

- `room_resource_id` is nullable at first.
- `bookings.room` remains as a display snapshot.
- Backfill is dry-run first and reports exact, alias, ambiguous, `Інше`, blank, and unknown counts.
- Ambiguous, `Інше`, blank, and unknown rows are not auto-mapped.
- Conflict locks and SQL checks keep legacy fallback until backfill coverage is proven.

## Live QA Contract

For documentation-only Task 2, no mutation live QA is required.

Read-only production API check on 2026-07-17 confirmed:

- 15 active room resources and 0 inactive room resources;
- active room resource names match the 15-room contract list below;
- `2026-07-17`: no room bookings, `room-takeaway` and `room-quarantine` present in `/api/lines`, 15 free rooms;
- `2026-07-21`: 3 room bookings, all diagnostic `ok`, 14 free / 1 occupied;
- `2026-02-04`: 1 room booking with `custom_room`, confirming quarantine is needed for real legacy/problem data.

Before product changes, repeat read-only checks on 2-3 dates:

- a date with no bookings;
- a date with active room bookings;
- a historical date with a quarantined/custom room if available.

Confirm with the product owner that these 15 active physical room names are still correct:

`Марвел`, `Ніндзя`, `Майнкрафт`, `Монстер Хай`, `Ельза`, `Растішка`, `Рок`, `Міньйон`, `Поні`, `Фудкорт`, `Жовтий стіл`, `Диван 1`, `Диван 2`, `Диван 3`, `Диван 4`.
