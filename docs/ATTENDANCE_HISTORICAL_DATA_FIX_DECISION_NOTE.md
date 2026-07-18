# Historical attendance data-fix decision note

Status: dry-run project prepared; write-mode apply is not allowed until the current dry-run output is reviewed and approved a second time.

## Approved owner scope

Approval text received in Codex:

- Owner: Director / Serhii
- Business reason: reports only, without changing payroll periods
- Date range: 2026-07-01 - 2026-07-18
- Categories:
  - late grace mismatch: yes
  - overtime grace mismatch: yes
  - missing plan source: no
  - inferred profession card: no
- Payroll periods:
  - locked/paid/closed periods can be changed: no
  - finance approval owner: N/A
- Apply mode allowed only after dry-run review: yes

Repository assumption for the database filter: `--business-context event_genix`.

## What the script is allowed to change

Script:

```bash
node scripts/fix-attendance-historical-grace.js
```

Allowed updates inside the approved date range and business context only:

1. `status = 'late'` with `late_minutes <= 5`
   - set `late_minutes = 0`;
   - recalculate legacy `status`:
     - `early_leave` if `early_leave_minutes > 0`;
     - otherwise `present`.

2. `overtime_minutes` from `1` to `15`
   - set `overtime_minutes = 0`;
   - do not change payroll reports or payroll periods.

The script does not update plan source, profession-card inference, payroll reports, payroll entries, payroll period locks, finance transactions, DB schema, or migrations.

## Dry-run command

Use a read-only connection string when possible:

```bash
ATTENDANCE_AUDIT_DATABASE_URL=<read-only-db-url> \
node scripts/fix-attendance-historical-grace.js \
  --from 2026-07-01 \
  --to 2026-07-18 \
  --business-context event_genix \
  --owner "Director / Serhii" \
  --reason "reports only; no payroll period changes" \
  --categories "late-grace,overtime-grace" \
  --format markdown
```

Dry-run uses `BEGIN READ ONLY` and does not update data.
Its terminal report is aggregate-only and does not include attendance record IDs or staff IDs.

## Apply gate

Apply requires all of the following:

1. Owner reviews the latest dry-run output.
2. Payroll impact does not include locked, closed, approved, or paid periods.
3. `--review-token` equals the dry-run `planHash`.
4. `--backup-dir` is provided.
5. `--confirm` exactly matches the confirmation string printed by dry-run.
6. `ATTENDANCE_DATA_FIX_DATABASE_URL` is set intentionally.
7. Both `payroll_reports` and `payroll_period_locks` guard tables are available; apply fails closed if either table cannot be verified.

The dry-run `planHash` binds the date range, business context, categories, owner, reason,
current candidate before/after values, and detected payroll impact.

Example shape only; do not run until the dry-run has been reviewed:

```bash
ATTENDANCE_DATA_FIX_DATABASE_URL=<write-db-url> \
node scripts/fix-attendance-historical-grace.js \
  --apply \
  --from 2026-07-01 \
  --to 2026-07-18 \
  --business-context event_genix \
  --owner "Director / Serhii" \
  --reason "reports only; no payroll period changes" \
  --categories "late-grace,overtime-grace" \
  --review-token <dry-run-planHash> \
  --backup-dir <secure-local-backup-dir> \
  --confirm "<exact-confirmation-from-dry-run>"
```

## Backup and audit trail

Before `UPDATE`, apply mode exports a JSON backup containing:

- targeted `hr_time_records`;
- related `hr_audit_log` rows;
- matching `payroll_reports` rows for impacted staff/months;
- matching `payroll_period_locks` rows;
- planned before/after changes;
- dry-run `planHash`;
- approval scope and owner.

Every changed attendance row also gets an `hr_audit_log` entry with action:

```text
attendance_historical_grace_data_fix
```

## Rollback instructions

Rollback is a separate write-mode operation and requires owner approval.

Safe rollback strategy:

1. Stop and preserve the backup JSON created before apply.
2. Confirm the `planHash`, date range, owner, and categories match the applied run.
3. Restore only `hr_time_records` fields from the backup:
   - `status`;
   - `late_minutes`;
   - `overtime_minutes`.
4. Do not rewrite payroll reports or payroll periods during rollback unless finance explicitly approves it.
5. Insert a new `hr_audit_log` action describing the rollback.
6. Run the read-only historical audit again for the same date range.

No rollback should be run from memory or from a manually edited list of IDs.

## Current decision

Proceed with dry-run only.

Apply remains blocked until the owner reviews the dry-run output and gives the second confirmation with the current `planHash`.
