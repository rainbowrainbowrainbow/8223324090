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

## Query budgets

`tests/schedule-query-budget.test.js` uses a parameter-redacting instrumented DB client and a synthetic
matrix of 100 staff members, 31 dates, 12 segments per day, main professions, and simultaneous additional
roles. The 31-day matrix pressure-tests the shared batch loaders; it does not bypass the request caps above.
Copy-week remains a seven-day API operation, and bulk requests remain capped at 500 staff/date entries.

Batch-stage query budgets are exact and independent of the number of staff/date pairs or segments:

| Flow | Staff lock | Profession cards | Source plans | Target plans | Schedule mirror load |
| --- | ---: | ---: | ---: | ---: | ---: |
| Staff bulk | 1 | 1 | 0 | 1 | 1 |
| Staff copy-week | 1 | 1 | 1 | 1 | 1 |
| HR bulk | 1 | 1 | 0 | 1 | 0 |
| HR copy-week | 1 | 1 | 1 | 1 | 0 |

HR flows write the legacy schedule mirror directly, so they do not need a separate mirror preload. They must
pass the already evaluated staff validation into the mirror writer; the mirror writer may query qualification
only for single-save callers that did not preload a card.

Persistence is intentionally linear in changed records, not in qualification checks. A brand-new 12-segment
child plan with one or more additional roles has a budget of 16 queries inside `replaceHrShiftSegments`:

- one parent lock;
- one parent envelope update;
- one existing-segment load;
- twelve segment inserts;
- one batched additional-role insert.

Adding more simultaneous roles does not add queries. Existing unchanged segments do not receive update
queries. Audit, roster reconciliation, and parent/mirror writes are outside the batch-read budget and remain
bounded by the documented entry/date caps.

The instrumentation records only phase, query category, and static SQL text. It never records SQL parameter
values or staff data. A budget failure lists the exact excess query numbers and sanitized SQL text.

Run the focused CI-compatible regression with `npm run test:schedule-query-budget`.

The controlled production/staging acceptance flow is documented in
[`LIVE_MULTI_SEGMENT_QA.md`](LIVE_MULTI_SEGMENT_QA.md). It is opt-in, requires an explicit confirmation
token and unique run ID, uses payroll preview only, and fails unless transactional cleanup is confirmed.

## Segment persistence

- Existing segment IDs supplied by the canonical editor are updated in place.
- A supplied segment ID must belong to the locked parent HR shift.
- New segments receive new IDs; removed segments are deleted through the parent-scoped diff.
- Copy-week intentionally omits source segment IDs so copied days receive fresh child IDs.

## Time policy

- Segment breaks use the MVP `segment_minutes_mvp` policy.
- `break_minutes` belongs only to its main segment. It must satisfy `0 <= break_minutes < segment duration`.
- For a reliable clock interval, actual paid minutes of each touched segment are
  `max(0, overlap(actual interval, segment) - min(overlap, break_minutes))`.
- Because the current model has no break window, partial attendance before and after an assumed break is intentionally indistinguishable. The same deterministic deduction is used in both cases.
- An untouched segment contributes neither worked minutes nor a break deduction.
- Simultaneous additional roles share the main segment interval. They do not receive another break allocation, worked-minute allocation, or payroll line.
- Payroll consumes the main-profession actual minutes produced by attendance. It must not subtract `break_minutes` a second time.
- `shift_end < shift_start` means the segment ends on the next calendar day. `shift_end = shift_start` remains invalid and does not mean a 24-hour shift.
- A single overnight segment is supported. Any multi-segment day containing an overnight segment is rejected with `HR_SHIFT_PLAN_AMBIGUOUS_POST_MIDNIGHT_SEGMENT` until explicit day offsets are approved and migrated.
- Time inside an envelope gap is not paid and is not overtime. Actual time before the first segment or after the last segment is overtime attributed once to the primary profession and requires reconciliation.

### Validation contract

| Rule | API code | Staff/HR behavior |
| --- | --- | --- |
| Break is equal to or longer than its segment | `HR_SHIFT_SEGMENT_BREAK_EXCEEDS_DURATION` | Block save and keep the editor open |
| Multi-segment plan contains an overnight block | `HR_SHIFT_PLAN_AMBIGUOUS_POST_MIDNIGHT_SEGMENT` | Block save; require one overnight block or a future explicit-offset model |

The Staff editor uses the same codes and base messages as the shared domain service. Routes return the domain
error unchanged; they must not reinterpret overnight or break rules independently.

The protected schema proposal for exact break windows and explicit day offsets is documented in
[`HR_SHIFT_SEGMENTS_TIME_MODEL_PROPOSAL.md`](HR_SHIFT_SEGMENTS_TIME_MODEL_PROPOSAL.md). It is not approved
for implementation and does not authorize a migration.
