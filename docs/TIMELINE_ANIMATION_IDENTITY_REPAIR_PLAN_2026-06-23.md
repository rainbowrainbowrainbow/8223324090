# Timeline Animation Identity Repair Plan

Production impact: yes.

This is a safe repair plan for existing bookings that already have broken timeline identity. It must be used only after reviewing the read-only report in `docs/TIMELINE_ANIMATION_IDENTITY_INVENTORY_READONLY_2026-06-23.sql`.

## Scope

- Do not change production data during inventory.
- Do not invent a line/resource when the report has no explicit evidence.
- Preserve original `bookings.extra_data`, `bookings.line_id`, and linked booking state before any repair.
- Prepare any future repair as a separate idempotent script/migration after operator review.

## Review Rules

- `animation_missing_line_id`: repair only when there is explicit evidence from UI source data, linked task notes, history, or a known selected animator. If evidence is missing, keep the row in manual review.
- `linked_missing_timeline_identity`: if `bookings.line_id` matches `lines_by_date` for the same `business_context/date`, rebuild only `extra_data.timelineIdentity` from that row. Do not rewrite `line_id`.
- `line_id_without_lines_by_date`: restore the missing `lines_by_date` row only when the staff/resource/date match is clear. Do not create a generic line.
- `timeline_identity_line_mismatch`: choose one canonical value using create/reload evidence. Preserve the previous identity under repair metadata before replacing it.
- `stored_missing_animator_resource`: rerun the report after the code-level projection fix. Repair data only for rows still missing a valid resource.
- `second_animator_missing_linked_booking`: create a linked booking only after checking time conflict, parent booking state, second animator identity, and expected zero-price linked-row behavior.

## Future Idempotent Repair Shape

1. Export the exact rows from the inventory report.
2. Build a reviewed input table/list with:
   - `booking_id`
   - `business_context`
   - `repair_kind`
   - `approved_line_id`
   - `approved_line_name`
   - `approved_parent_booking_id` when needed
   - reviewer name/date
3. Run repairs inside a transaction.
4. Match each row by `booking_id` and `business_context`.
5. Use `jsonb_set` only for approved `extra_data.timelineIdentity` changes.
6. Keep old values in `extra_data.timelineIdentityRepair.previous`.
7. Never overwrite a row if current DB values no longer match the reviewed inventory snapshot.
8. Commit only when affected row counts equal the reviewed input count.
9. Rerun the read-only inventory and confirm the same rows no longer appear.

## Verification After Repair

- Rerun `docs/TIMELINE_ANIMATION_IDENTITY_INVENTORY_READONLY_2026-06-23.sql`.
- Open affected dates through `GET /api/bookings/:date?timelineView=animators`.
- Confirm repaired bookings have stable `timelineProjection.resourceId`, `timelineProjection.lineId`, and no `hiddenReason: missing_animator_resource`.
- Confirm rooms timeline does not start showing linked animator child rows unless a separate product rule allows it.
- Keep the pre-repair export attached to the release/incident note.
