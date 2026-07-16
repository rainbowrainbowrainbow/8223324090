# Attendance logic

## Source of the daily plan

`resolveAttendancePlan(staffId, date)` uses the following priority:

1. Explicit HR shift and its segments for the requested date.
2. Saved weekday/weekend hours of the employee's primary profession.
3. Explicit `unscheduled` result when neither source exists.

Additional professions do not provide an implicit fallback schedule. They require an explicit dated shift.

## Reporting rules

| Fact | Rule |
| --- | --- |
| Late arrival | `late_minutes > 5` |
| Early leave | `early_leave_minutes > 15` at calculation time |
| Overtime | `overtime_minutes > 15` at calculation time |

Late arrival, early leave, and overtime are independent facts. A single attendance day may contain any combination of them. Settlement mode controls paid minutes only and does not remove attendance facts.

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

## Known limitations

- Historical attendance and payroll records are not recalculated automatically.
- A legacy row with `status = late` and `late_minutes <= 5` is not counted as late in current reports.
- A historical row without a stored plan source may infer `profession_card` from its planned-time snapshot when no dated HR shift can be loaded.
- Break windows are not stored separately. Segment break minutes use the documented deterministic MVP allocation policy.
- Live QA must use test employees and safe test records only. It must not alter locked or real payroll periods.
