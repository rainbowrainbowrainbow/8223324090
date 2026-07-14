# HR Shift Segment Operations

This document defines the operational limits and transaction rules for multi-segment Staff and HR schedule writes.

## Request caps

- Staff schedule bulk: at most 500 unique `(staffId, date)` entries, 500 staff members, and 31 distinct dates.
- HR shift bulk: at most 500 Cartesian staff/date entries, 500 staff members, and 31 distinct dates.
- Staff and HR copy-week: exactly 7 calendar dates and at most 500 source staff members.
- One working day: at most 12 paid segments.

Requests exceeding a cap fail before schedule writes. Duplicate staff/date entries are invalid instead of being silently merged.

## Read and lock model

- Staff rows are locked in ascending staff ID order before target plans or mirrors are locked.
- Source plans, target plans, schedule mirrors, and staff qualification cards are loaded in batches.
- Qualification is evaluated in memory for every target date from the fresh locked staff card; routes must not query the staff card once per date or segment.
- Payroll profession rates are not needed for schedule mutations. Payroll preview loads profession rate maps in a separate batch for all selected staff.
- Any validation, persistence, reconciliation, or audit failure rolls the entire bulk/copy transaction back.

## Segment persistence

- Existing segment IDs supplied by the canonical editor are updated in place.
- A supplied segment ID must belong to the locked parent HR shift.
- New segments receive new IDs; removed segments are deleted through the parent-scoped diff.
- Copy-week intentionally omits source segment IDs so copied days receive fresh child IDs.

## Time policy

- Segment breaks use the MVP `segment_minutes_mvp` policy: a break belongs to one segment and is deducted only from actual minutes touching that segment.
- A single overnight segment is supported. A multi-segment day containing an overnight segment is rejected until explicit day offsets are approved and migrated.
