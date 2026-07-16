# Attendance logic

## Source of the daily plan

`resolveAttendancePlan(staffId, date)` uses the following priority:

1. Explicit HR shift and its segments for the requested date.
2. Saved weekday/weekend hours of the employee's primary profession.
3. Explicit `unscheduled` result when neither source exists.

Additional professions do not provide an implicit fallback schedule. They require an explicit dated shift.

## Plan source contract

Attendance mutation responses use one of four source values:

- `hr_shift` — the first check-in used an explicit dated HR shift.
- `profession_card` — the first check-in used the primary profession card fallback.
- `unscheduled` — the first check-in had no plan.
- `attendance_snapshot` — legacy fallback for an existing attendance row when the original source cannot be read from the first `clock_in` audit entry.

Repeated check-in and check-out responses read the original `plan_source` from `hr_audit_log.details` for the first `clock_in`. They do not re-resolve the current HR shift or profession card to name an existing row. This keeps `record.plan_source`, `plan.source`, and top-level `planSource` aligned and prevents a deleted HR shift from turning historical API responses into `profession_card`.

## Reporting rules

| Fact | Rule |
| --- | --- |
| Late arrival | `late_minutes > 5` |
| Early leave | `early_leave_minutes > 15` at calculation time |
| Overtime | `overtime_minutes > 15`; values from one to fifteen minutes are not reportable overtime |

Late arrival, early leave, and overtime are independent facts. A single attendance day may contain any combination of them. Settlement mode controls paid minutes only and does not remove attendance facts.

`overtime_minutes` / `overtimeMinutes` are attendance facts: they represent clock-out after `planned_end` only when the overtime grace is exceeded. Segment allocation can also report minutes worked outside the planned shift envelope, including early arrival. That technical value is exposed separately as `allocation_overtime_minutes` / `allocationOvertimeMinutes`, with `overtime_allocation` carrying the profession allocation payload. Allocation overtime must not overwrite `overtime_minutes` in decorated attendance records or report rows.

Today, daily reports, monthly HR summaries, payroll workspace reconciliation, and CSV export use the same reportable attendance facts. They do not derive overtime from `status`, and they do not turn allocation overtime into an attendance event.

User-facing plan warnings should be written for HR users, not engineers:

- `profession_card` — `План дня взято з картки основної професії`.
- `unscheduled` — `Для працівника не задано плановий час`.

The HR monthly report shows separate counts for profession-card fallback days and days without a plan. CSV export uses semicolon-separated rows with safe escaping for semicolons, quotes, newlines, tabs, and formula-like prefixes (`=`, `+`, `-`, `@`) so exported rows keep a stable column count.

The first check-in and first check-out are idempotent. Manual correction recalculates all facts through the same attendance calculation used by normal clock-out.

## Regression matrix

Automated coverage includes:

- no shift and no profession-card hours;
- profession-card fallback;
- explicit dated HR shift;
- arrival delays of five and six minutes;
- early departures of fifteen and sixteen minutes;
- overtime of fifteen and sixteen minutes;
- late arrival combined with early leave;
- overnight shifts across the Kyiv date boundary;
- repeated check-in and check-out;
- manual correction recalculation;
- consistent Today, monthly report, payroll, and CSV presentation rules.
- stable CSV column count and formula-prefix escaping.

## Known limitations

- Historical attendance and payroll records are not recalculated automatically.
- A legacy row with `status = late` and `late_minutes <= 5` is not counted as late in current reports.
- Reports keep their documented historical inference fallback: a row without a stored plan source may infer `profession_card` from its planned-time snapshot when no dated HR shift can be loaded. Mutation responses for old rows use neutral `attendance_snapshot` instead.
- Break windows are not stored separately. Segment break minutes use the documented deterministic MVP allocation policy.
- Live QA must use test employees and safe test records only. It must not alter locked or real payroll periods.
