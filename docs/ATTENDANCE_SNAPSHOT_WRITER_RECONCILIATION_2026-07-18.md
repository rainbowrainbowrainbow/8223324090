# Attendance snapshot writer reconciliation — 2026-07-18

Production impact: yes.

## Read-only production finding

The production audit used a `REPEATABLE READ READ ONLY` PostgreSQL transaction and
did not output staff names, identifiers, rates, payroll amounts, or other personal
data.

Coverage after the `2026-07-18` effective date:

| Group | Records |
| --- | ---: |
| Total attendance records | 15 |
| With compensation snapshot | 1 |
| Without compensation snapshot | 14 |

All 14 records without a snapshot were classified as `import`:

- note category: `hermes_import`;
- audit action: `attendance_hermes_apply`;
- clock-in present, clock-out absent;
- status: `present` or `late`;
- no auto-close or correction markers.

The root cause was a direct `INSERT INTO hr_time_records` in
`services/hermesAttendanceImport.js`, outside the canonical attendance service.
No historical record was changed and no compensation was backfilled.

## Writer inventory and remediation

| Writer path | Result |
| --- | --- |
| Manual HR clock-in/out | Already canonical |
| Camera/face clock-in/out | Already canonical |
| Live QA helper | Already canonical |
| Auto-close | Already finalizes through canonical clock-out |
| Hermes attendance import | Moved to canonical clock-in |
| HR mark absent/sick/vacation/day-off | Moved to canonical terminal-status writer |
| Leave request approval | Moved to canonical terminal-status writer |
| No-show scheduler | Moved to canonical terminal-status writer |
| Manual correction | Already rebuilds and audits the snapshot |
| Backup/recovery restore | Preserves stored history; no synthetic snapshot |

The terminal-status writer creates a final zero-minute snapshot for base-only
attendance as well. It rejects replacing a record that already contains clock or
worked-minute facts with `ATTENDANCE_STATUS_CONFLICT`.

## Historical data policy

- Existing records without a snapshot remain unchanged.
- No automatic backfill is allowed in this release.
- Legacy payroll remains base-only for records without a snapshot.
- A historical backfill, if ever required, must be a separate approved financial
  operation with reconciliation and audit.

## Verification and follow-up

Use `scripts/audit-attendance-snapshot-writers.js` after deployment with:

```powershell
$env:ATTENDANCE_SNAPSHOT_AUDIT_CONFIRM='READ_ONLY_ATTENDANCE_SNAPSHOT_AUDIT'
railway run --service Postgres --environment production node scripts/audit-attendance-snapshot-writers.js
```

The post-deployment audit must show no newly created supported attendance record
without a compensation snapshot. The historical 14 Hermes records are expected
to remain unchanged.
