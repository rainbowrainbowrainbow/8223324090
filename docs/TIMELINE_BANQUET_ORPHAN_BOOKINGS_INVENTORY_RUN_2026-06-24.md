# Timeline Banquet Orphan Bookings Inventory Run - 2026-06-24

Production impact: yes, read-only audit only.

## Status

Blocked: production read-only database credentials were not available in the current Codex environment.

The report was not executed against production. No production data was read or changed.

## Preflight Evidence

- Branch: `codex/timeline-leads-hardening`
- Runtime: Node `22.23.0` / npm `10.9.8`
- SQL report inspected: `docs/TIMELINE_BANQUET_ORPHAN_BOOKINGS_INVENTORY_READONLY_2026-06-24.sql`
- SQL safety: starts `BEGIN TRANSACTION READ ONLY`, contains report `SELECT` statements, and has no repair/update/delete/attach statements.
- Process environment DB variables: none found for `DATABASE`, `POSTGRES`, `PG`, `SUPABASE`, or `RAILWAY`.
- Workspace env files:
  - `.env`: no DB variables listed.
  - `.env.e2e.local`: local/dev `PGHOST`, `PGDATABASE`, `PGUSER`, `PGPASSWORD`, not production read-only credentials.
- `psql`: not installed/available in PATH.

## Required Input To Complete

Provide a production read-only PostgreSQL connection through one of these safe options:

- `PRODUCTION_READONLY_DATABASE_URL`
- `DATABASE_URL` only if it is explicitly a read-only production user
- `PGHOST`, `PGDATABASE`, `PGUSER`, `PGPASSWORD`, `PGPORT` only if that user is explicitly read-only

Do not use production write credentials for this report.

## Run Command

Preferred, if `psql` is available:

```bash
psql "$PRODUCTION_READONLY_DATABASE_URL" -f docs/TIMELINE_BANQUET_ORPHAN_BOOKINGS_INVENTORY_READONLY_2026-06-24.sql
```
If `DATABASE_URL` is the confirmed read-only URL:

```bash
psql "$DATABASE_URL" -f docs/TIMELINE_BANQUET_ORPHAN_BOOKINGS_INVENTORY_READONLY_2026-06-24.sql
```

Save the output as:

```text
docs/TIMELINE_BANQUET_ORPHAN_BOOKINGS_INVENTORY_OUTPUT_2026-06-24.txt
```

## Repair Task Template

Create one task per high-confidence `orphan_candidate_detail` row after manual review:

```text
TASK REPAIR BANQUET ORPHAN <N> - Review and attach standalone booking

Production impact: yes.

Goal:
Review suspected orphan booking <booking_id> and attach it to banquet group <candidate_group_id> only if the operator confirms it belongs to that banquet.

Evidence:
- booking_id: <booking_id>
- date/time: <date> <time_range>
- customer: <customer_id> / <customer_name>
- room/line: <room> / <line_id>
- candidate group: <candidate_group_id>
- primary booking: <candidate_primary_booking_id>
- distance minutes: <distance_minutes>
- suspected reason: <suspected_reason>
- suggested role: <suggested_role>

Do:
- Open booking <booking_id> in CRM and verify it is not an intentional standalone booking.
- Open banquet group <candidate_group_id> and verify the customer/date/room/menu/activity context.
- Confirm target group and role with manager/admin.
- Attach only after confirmation:
  POST /api/banquets/:groupId/bookings
  body:
  {
    "bookingId": "<booking_id>",
    "role": "<suggested_role>",
    "label": "manual orphan repair"
  }
- Verify banquet summary includes the booking.
- Verify timeline still shows the booking in the correct room/animator line.

Do not:
- Do not auto-merge.
- Do not delete the standalone booking.
- Do not change customer/date/time/price during attach.
- Do not attach if the candidate group is ambiguous.

Acceptance:
- Operator confirmed the target banquet group.
- Booking is attached through the canonical banquet endpoint.
- Banquet summary and timeline are correct after reload.
- Original booking id remains available for audit.
```
