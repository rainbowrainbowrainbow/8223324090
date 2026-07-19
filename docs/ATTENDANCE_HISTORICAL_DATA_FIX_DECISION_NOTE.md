# Historical attendance data-fix decision note

Status: deferred pending a read-only production audit. Write-mode apply is not allowed.

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

1. `status = 'late'` with `late_minutes` from `1` to `5`
   - set `late_minutes = 0`;
   - recalculate legacy `status`:
     - `early_leave` if `early_leave_minutes > 0`;
     - otherwise `present`.
   - do not include `NULL`, `0`, or negative `late_minutes`; those are read-only audit counts and need separate approval before any write-mode tooling.

2. `overtime_minutes` from `1` to `15`
   - set `overtime_minutes = 0`;
   - do not change payroll reports or payroll periods.

The script does not update plan source, profession-card inference, payroll reports, payroll entries, payroll period locks, finance transactions, DB schema, or migrations.

## Dry-run command

Use a dedicated read-only connection string. Dry-run intentionally refuses
`ATTENDANCE_DATA_FIX_DATABASE_URL`, generic `DATABASE_URL`, and accidental `PG*`
fallbacks.

```bash
ATTENDANCE_AUDIT_DATABASE_URL=<read-only-db-url> \
node scripts/fix-attendance-historical-grace.js \
  --from 2026-07-01 \
  --to 2026-07-18 \
  --business-context event_genix \
  --approved-by "Director / Serhii" \
  --executed-by "<operator name>" \
  --reason "reports_only; no payroll period changes" \
  --categories "late-grace,overtime-grace" \
  --max-records 500 \
  --format markdown
```

Dry-run uses `BEGIN READ ONLY` and does not update data.
Its terminal report is aggregate-only and does not include attendance record IDs or staff IDs.
It also prints a canonical approval manifest with:

- operation ID;
- git SHA;
- script SHA-256;
- script version;
- database fingerprint without credentials;
- database role;
- approved scope;
- aggregate category counts and overlap;
- `planHash`;
- creation and expiration timestamps.

## Apply gate

Apply requires all of the following:

1. Owner reviews the latest dry-run output.
2. Payroll impact does not include locked, closed, approved, or paid periods.
3. `--review-token` equals the dry-run `planHash`.
4. The current candidate count is `> 0` and `<= --max-records`.
5. `--backup-dir` is provided.
6. `--confirm` exactly matches the confirmation string printed by dry-run.
7. `ATTENDANCE_DATA_FIX_DATABASE_URL` is set intentionally.
8. Both `payroll_reports` and `payroll_period_locks` guard tables are available; apply fails closed if either table cannot be verified.

The dry-run `planHash` binds the date range, business context, categories, owner, reason,
current candidate before/after values, detected payroll impact, git SHA, script SHA-256,
script version, and DB fingerprint. The approval manifest records DB role separately,
but the role is not part of `planHash` so the reviewed read-only dry-run can be applied
through the separately approved write role against the same database fingerprint.

Example shape only; do not run until the dry-run has been reviewed:

```bash
ATTENDANCE_DATA_FIX_DATABASE_URL=<write-db-url> \
node scripts/fix-attendance-historical-grace.js \
  --apply \
  --from 2026-07-01 \
  --to 2026-07-18 \
  --business-context event_genix \
  --approved-by "Director / Serhii" \
  --executed-by "<operator name>" \
  --reason "reports_only; no payroll period changes" \
  --categories "late-grace,overtime-grace" \
  --max-records 500 \
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

The audit row stores `approved_by` and `executed_by` separately. The database
`performed_by` value uses the bounded `executed_by` actor.

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

## Execution record (2026-07-19)

### Historical audit and data-fix

| Item | Result |
| --- | --- |
| Tooling branch baseline | Synced with `origin/codex/performance-hardening` v`0.79.85` on `2026-07-19`; no production data was changed during sync. |
| Approved date range | `2026-07-01` through `2026-07-18` |
| Approved categories | `late-grace`, `overtime-grace` only |
| Excluded categories | `missing plan source`, `inferred profession card` |
| Additional read-only bucket | `null-zero-negative-late`; not writable without separate owner approval |
| Tooling guard update | v2 narrows late candidates to `late_minutes 1..5`, refuses write/generic DB URLs for dry-run, adds `--max-records`, compare-and-set updates, and canonical approval manifest. |
| Read-only dry-run | **Blocked**: no approved read-only production database connection was available. |
| Dry-run candidate counts | Not measured. |
| Dry-run `planHash` | Not produced. |
| Protected payroll overlap | Not measured; therefore apply must fail closed. |
| Apply | Not run. |
| Changed attendance records | 0. |
| Backup reference | None; apply did not start. |
| Rollback | Not applicable; no production data was changed. |

The prepared script and its tests are reviewable tooling only. It was not connected to a
production database during this work. A second owner confirmation is impossible until a
fresh dry-run provides an exact `planHash`, aggregate counts, and zero protected payroll
overlap.

### Disposable overtime UI QA

The controlled disposable-fixture QA was completed without payroll-period changes and
without retained fixture data:

- API, payroll preview, and CSV confirmed a `+16 minute` attendance overtime fact.
- A separate `+15 minute` case remained at zero attendance overtime while retaining
  separate allocation overtime, as intended.
- Cleanup independently confirmed zero active disposable staff matches, attendance rows,
  check-ins, shifts, and `staff_shift_preferences` rows for the fixture run.
- The HR monthly DOM could not display the future fixture month: its period picker exposes
  the current and eleven previous months only. This is a **UI QA limitation**, not evidence
  that the attendance result is wrong. The positive overtime DOM check is therefore deferred.

No employee identifiers, credentials, or production data exports are recorded here.

## Current decision

Keep the historical correction deferred. The next required owner-facing input is an
approved read-only production database connection for the scoped dry-run. After that,
review the measured counts and `planHash` before requesting the separate apply confirmation.
