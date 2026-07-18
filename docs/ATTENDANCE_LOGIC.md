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

## Physical time and compensation allocations

`segmentAllocations` remains the physical-time source of truth. A minute of presence is counted once even
when the employee performs two professions simultaneously.

`compensationAllocations` is a separate immutable payroll input:

- `base` records the main profession's compensated minutes;
- `simultaneous_additional` records an explicitly paid additional profession;
- each allocation stores profession, planned and actual minutes, compensation mode, multiplier, explicit
  rate source, policy version, attendance reference, segment reference, and role reference;
- additional-role minutes never increase `total_worked_minutes`, physical hours, or worked days;
- the sum of compensation minutes may legitimately exceed the physical minutes.

The first check-in snapshots the dated plan. Clock-out intersects the actual interval with that saved plan
and stores the final result in the same attendance transaction. Later schedule or rate edits do not
silently recalculate a closed attendance record. Manual correction stores before/after compensation
snapshots, a reason, and an explicit `compensation_snapshot_corrected` audit event.

Legacy attendance rows without a compensation snapshot use base-only payroll logic and must not acquire
retroactive paid additional roles. An invalid or incomplete paid-role snapshot requires manual review and
blocks payroll commit instead of resolving to zero or falling back to the employee's general hourly rate.

For the canonical `11:00–20:00` base interval with a simultaneous paid role from `11:30–20:00`:

| Metric | Result |
| --- | ---: |
| Physical minutes | 540 |
| Base-role minutes | 540 |
| Additional-role minutes | 510 |
| Physical hours shown in payroll | 9 |
| Total role-compensation hours | 17.5 |

The 17.5 role-compensation hours must never be labeled simply as “worked hours”.

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

## Post-release QA v0.79.51

Release sanity evidence:

- Commit: `a61e7b275180023626f8510b1da21c068774a6f0`.
- Branch: `codex/performance-hardening`.
- Deployed version: `v0.79.51` / `Attendance Review Reliability`.
- CI: GitHub Actions passed for the deployed commit. The first attempt had a flaky HR onboarding browser smoke failure; the failed job was rerun and passed before production QA was accepted.
- Runtime: Railway resolved Node `22.23.1`.

Production QA was performed only with disposable test staff and marker-bound attendance fixtures. No payroll periods were created or closed, no mass data-fix was run, and no production config was changed.

Verified production surfaces:

- HR Today and KPI `present`: open attendance (`clock_in` without `clock_out`) is counted; closed attendance remains visible in the Today list but does not count as present.
- Daily HR report and `/api/staff/attendance`: normalized attendance facts match for the same records.
- Monthly HR report: late, early leave, and overtime totals match the detailed day rows.
- Payroll preview/workspace: attendance overtime is consumed from attendance facts; allocation overtime is not treated as an attendance event.
- CSV export: rows keep a stable 17-column shape and report the same late, early leave, overtime, and plan-source values as the screen-backed report APIs.

Verified boundary scenarios:

- late arrival: five minutes is not reportable late, six minutes is reportable late;
- early leave: fifteen minutes is not reportable early leave, sixteen minutes is reportable early leave;
- overtime: fifteen minutes is not reportable attendance overtime, sixteen minutes is reportable attendance overtime;
- allocation overtime can exist without attendance overtime;
- a day can contain late arrival plus early leave;
- a day can contain late arrival plus overtime;
- `profession_card` and `unscheduled` warnings are present and user-facing.

Post-release backlog:

- Historical data-fix/backfill is a separate task and requires explicit approval before any recalculation.
- Browser/DOM visual smoke for the HR report pages remains optional follow-up; this release QA verified the production API surfaces that drive those screens and CSV.
- The live QA cleanup helper deletes marker-bound fixture attendance, check-ins, shifts, schedules, and `staff_shift_preferences`, then archives the disposable staff row. Cleanup remains scoped to a staff row that passes the disposable QA name and exact `runId` guard.
- Base CSV escaping and stable-column tests exist; extend route-level CSV coverage only if the export contract changes.

## Production QA v0.79.75 — true profession-card fallback

This owner-facing QA note closes the true `profession_card` fallback smoke that was run with disposable
fixtures only. It documents the state that was verified at the time of the run; production later advanced
to `v0.79.76`, so this evidence must not be confused with the current production tip.

Production evidence:

- Verified release: `v0.79.75` / `Payroll Reporting Transparency`.
- Commit: `201ef640059e4106b16333ed8b5a49de5fb43ebf`.
- Branch: `codex/performance-hardening`.
- GitHub CI: success for run `29646032917`.
- Railway deployment/status context: success for the same commit.
- This QA was performed on `v0.79.75`, not on the older `v0.79.74` release.

Disposable fixture runs:

- `prefqa_mrqekg53`
- `prefqa_mrqemduz`
- `prefqa_alloc_mrqeq121`

Verified results:

- HR Today returned plan source `profession_card`.
- HR warning code was `PROFESSION_CARD_FALLBACK`.
- Daily report, monthly HR report, `/api/staff/attendance`, and CSV used the same attendance facts and
  plan-source interpretation for the tested date.
- Payroll attendance overtime remained `0`.
- Allocation overtime stayed technical allocation data and did not become reportable attendance overtime.

Cleanup evidence after the disposable runs:

| Fixture data | Remaining rows |
| --- | ---: |
| Active disposable staff | 0 |
| Attendance rows | 0 |
| Check-in rows | 0 |
| `staff_shift_preferences` rows | 0 |

The first attempted run produced a false negative from the QA script assertion/encoding path. Cleanup was
confirmed afterwards, and the failure was classified as a test-script issue rather than a product bug.

## Known limitations

- Historical attendance and payroll records are not recalculated automatically.
- A legacy row with `status = late` and `late_minutes <= 5` is not counted as late in current reports.
- Reports keep their documented historical inference fallback: a row without a stored plan source may infer `profession_card` from its planned-time snapshot when no dated HR shift can be loaded. Mutation responses for old rows use neutral `attendance_snapshot` instead.
- Break windows are not stored separately. Segment break minutes use the documented deterministic MVP allocation policy.
- Live QA must use test employees and safe test records only. It must not alter locked or real payroll periods.
