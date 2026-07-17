# HR Shift Segment Exact-Time Proposal

Status: proposal only. No migration is authorized by this document.

This exact-time proposal does not itself enable pay for simultaneous additional roles. Current production
remains base-only. If the separately versioned
[`simultaneous-profession-pay-v1`](HR_SIMULTANEOUS_PROFESSION_PAY_POLICY.md) policy is later approved,
implemented, and activated, that policy governs compensation semantics while this document continues to
govern exact break windows and day offsets.

## Problem

The current normalized segment model deliberately stores only `break_minutes` and wall-clock `TIME` values.
It safely supports one overnight segment, but it cannot answer two exact questions:

1. Did partial attendance occur before, during, or after a specific break window?
2. Does a separate `01:00-03:00` segment belong to `shift_date` or to the following day?

The current MVP therefore uses `segment_minutes_mvp` and rejects every multi-segment day that contains an
overnight segment. These rules are deterministic, but intentionally conservative.

## Recommended additive model

After separate explicit approval, add nullable/compatible columns to `hr_shift_segments`:

| Column | Type | Initial/backfill value |
| --- | --- | --- |
| `start_day_offset` | `SMALLINT NOT NULL DEFAULT 0` | `0` |
| `end_day_offset` | `SMALLINT NOT NULL DEFAULT 0` | `1` when legacy `planned_end <= planned_start`, otherwise `0` |
| `break_start` | `TIME` | `NULL` |
| `break_end` | `TIME` | `NULL` |
| `break_start_day_offset` | `SMALLINT` | `NULL` |
| `break_end_day_offset` | `SMALLINT` | `NULL` |

Recommended first-version limits:

- day offsets are limited to `0` or `1`;
- segment absolute end must be after absolute start and duration must be shorter than 24 hours;
- both break endpoints and both break offsets are either all `NULL` or all present;
- an exact break interval must be fully inside its parent segment;
- `break_minutes` remains the compatibility value and must equal the exact break-window duration when a window exists;
- one exact break window per segment is enough for the first version;
- overlap remains a transactional domain-service check; do not add PostgreSQL extensions.

Absolute time math should use `(day_offset * 1440) + time_minutes`. API payload fields should be
`startDayOffset`, `endDayOffset`, `breakStart`, `breakEnd`, `breakStartDayOffset`, and `breakEndDayOffset`,
with snake_case aliases only at persistence boundaries.

## Attendance and payroll behavior after adoption

- Attendance subtracts only the intersection with the exact break window.
- Partial attendance wholly before or after the break is not reduced by that break.
- Attendance still creates one daily record and one clock-in/out interval.
- Additional simultaneous roles still receive no separate minutes or pay.
- Payroll continues to consume attendance allocations and never independently subtracts a break.
- Time outside planned segments remains overtime attributed once to the primary profession.

## Read-only production preflight

Before requesting migration approval, run a read-only report that counts:

- total and overnight segments;
- segments where `planned_start = planned_end`;
- rows where `break_minutes < 0` or `break_minutes >= calculated duration`;
- multi-segment days containing an overnight segment;
- plans whose parent envelope or break total differs from normalized children;
- attendance rows linked to overnight plans;
- payroll periods containing those attendance rows.

The preflight must output counts and test fixture IDs only. It must not update production rows or print staff
names, credentials, or payroll amounts.

## Migration sequence after approval

1. Add nullable/defaulted columns and simple checks in a new additive migration with `MIGRATION_KIND`,
   `SAFETY`, and `ROLLBACK` headers.
2. Backfill segment day offsets from the current overnight convention in the same controlled migration or an
   separately approved idempotent data migration.
3. Deploy dual-read code that accepts old rows and emits explicit offsets.
4. Add API/UI support and focused overnight/break-window tests.
5. Enable exact break allocation only after read-after-write and payroll preview comparison pass.
6. Keep legacy `planned_start`, `planned_end`, and `break_minutes` populated for backward compatibility.

## Rollback

Application rollback must return to the current `segment_minutes_mvp` behavior while leaving additive columns
in place. Do not delete production segment or break-window data during an emergency rollback. A later schema
cleanup may drop unused columns only after a separate destructive-change approval and proof that no deployed
version reads them.

## Rejected shortcuts

- Do not infer post-midnight continuation from segment sort order.
- Do not reuse `break_minutes` as an approximate break start.
- Do not create separate attendance records or payroll lines for additional simultaneous roles.
- Do not replace calendar-local dates with UTC conversions.
- Do not add range/overlap PostgreSQL extensions only for this feature.
