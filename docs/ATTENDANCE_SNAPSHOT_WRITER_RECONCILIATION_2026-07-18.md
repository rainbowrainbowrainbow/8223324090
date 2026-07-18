# Attendance snapshot writer reconciliation — 2026-07-18

Production impact: yes.

## Read-only production finding before canonical writer fix

The production audit used a `REPEATABLE READ READ ONLY` PostgreSQL transaction and
did not output staff names, identifiers, rates, payroll amounts, or other personal
data.

Coverage after the `2026-07-18` effective date in the pre-fix snapshot:

| Group | Records |
| --- | ---: |
| Total attendance records | 15 |
| With compensation snapshot | 1 |
| Without compensation snapshot | 14 |

All 14 records without a snapshot were classified as `hermes_import`:

- note category: `hermes_import`;
- audit action: `attendance_hermes_apply`;
- clock-in present, clock-out absent;
- status: `present` or `late`;
- no auto-close or correction markers.

The root cause was a direct `INSERT INTO hr_time_records` in
`services/hermesAttendanceImport.js`, outside the canonical attendance service.
No historical record was changed and no compensation was backfilled.

## Writer inventory and remediation status

| Writer path | Status |
| --- | --- |
| Manual HR clock-in/out | Completed: canonical |
| Camera/face clock-in/out | Completed: canonical |
| Live QA helper | Completed: canonical |
| Auto-close | Completed: finalizes through canonical clock-out |
| Hermes attendance import | Completed: moved to canonical clock-in |
| HR mark absent/sick/vacation/day-off | Completed: moved to canonical terminal-status writer |
| Leave request approval | Completed: moved to canonical terminal-status writer |
| No-show scheduler | Completed: moved to canonical terminal-status writer |
| Manual correction | Completed: rebuilds and audits snapshot correction |
| Backup/recovery restore | Not a new writer; preserves stored history and does not synthesize snapshots |

The terminal-status writer creates a final zero-minute snapshot for base-only
attendance as well. It rejects replacing a record that already contains clock or
worked-minute facts with `ATTENDANCE_STATUS_CONFLICT`.

## Historical data policy

- Existing records without a snapshot remain unchanged.
- The 14 Hermes records are historical pre-cutoff exceptions, not a current
  regression signal.
- No automatic backfill is allowed in this release.
- Legacy payroll remains base-only for records without a snapshot.
- A historical backfill, if ever required, must be a separate approved financial
  operation with reconciliation and audit.

## Post-fix delta audit contract

`scripts/audit-attendance-snapshot-writers.js` now audits two independent axes:

1. `record_date >= 2026-07-18` defines the active payroll policy population.
2. `created_at >= <deployment cutoff>` defines the post-fix writer behavior
   cohort.

The deployment cutoff must be the exact deploy-completed timestamp from CI or
Railway deployment evidence. Do not use the commit timestamp; the local repo only
proves which commit introduced the code change, not when production started
running it.

Required runtime inputs:

```powershell
$env:ATTENDANCE_SNAPSHOT_AUDIT_CONFIRM = 'READ_ONLY_ATTENDANCE_SNAPSHOT_AUDIT'
$env:ATTENDANCE_SNAPSHOT_DEPLOYED_AT = '<exact CI/Railway deploy-completed timestamp with timezone>'
$env:ATTENDANCE_SNAPSHOT_DEPLOYMENT_EVIDENCE = '<short evidence label; do not include secrets or IDs>'
node scripts/audit-attendance-snapshot-writers.js --release-gate
```

The script keeps `BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`
and always finishes with `ROLLBACK`. Production output is aggregate-only: no
staff names, staff IDs, attendance IDs, notes, audit payloads, rates, amounts, or
production identifiers.

The report includes aggregate coverage counters for the policy population,
pre-cutoff records and post-fix records. If these counters unexpectedly show no
policy records or differ from the pre-fix 15/14 baseline, treat it as context or
data drift to investigate; do not replace the delta gate with a simple “total is
still 14” check.

## Release-gate rules

The release gate fails if any post-fix cohort contains:

| Blocker | Meaning |
| --- | --- |
| `ATTENDANCE_POST_FIX_MISSING_SNAPSHOT` | New post-fix attendance without compensation snapshot |
| `ATTENDANCE_POST_FIX_PAID_ALLOCATION_WITHOUT_FINAL_SNAPSHOT` | Paid allocation exists without a valid final snapshot |
| `ATTENDANCE_POST_FIX_UNKNOWN_WRITER` | New writer path cannot be classified |
| `ATTENDANCE_SNAPSHOT_AUDIT_INCOMPLETE` | Required columns/query/classification contract is incomplete |

Historical Hermes exceptions are reported as a dated warning and do not pass or
fail the post-fix gate. This intentionally prevents the unsafe check “the total
is still 14”: a new missing snapshot cannot be hidden by a changing historical
baseline.

## If a new gap appears

Do not backfill or recalculate production payroll in this audit task. Create a
separate code-fix task for the exact writer path and keep any financial data fix
as a separate explicitly approved operation.

## Post-fix production delta audit — 2026-07-18

Read-only release-gate audit was run with deployment cutoff
`2026-07-18T12:17:59Z`, taken from GitHub deployment status `success` for the
v0.79.73 release commit that contains the canonical writer fix.

Aggregate result:

| Counter | Records |
| --- | ---: |
| Policy records, `record_date >= 2026-07-18` | 15 |
| Policy records with snapshot | 15 |
| Policy records without snapshot | 0 |
| Pre-cutoff records | 15 |
| Pre-cutoff records with snapshot | 15 |
| Pre-cutoff records without snapshot | 0 |
| Post-fix records | 0 |
| Post-fix missing snapshots | 0 |
| Post-fix paid allocation without valid final snapshot | 0 |
| Post-fix unknown writers | 0 |

Release gate status: `passed`.

This task did not modify production data. The current aggregate differs from the
pre-fix audit that found 14 Hermes records without snapshots. Treat that as a
separate read-only data-history question if the exact historical data transition
matters. Do not backfill, reverse, regenerate, or recalculate payroll from this
audit task.
