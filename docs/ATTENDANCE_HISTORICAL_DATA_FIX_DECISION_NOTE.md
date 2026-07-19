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
2. Payroll impact is clean. Apply fails closed on locked, draft/open, reviewed, approved,
   paid, committed, finance-linked payroll reports, payroll entries, salary adjustments,
   and salary finance transactions.
3. `--review-token` equals the dry-run `planHash`.
4. The current candidate count is `> 0` and `<= --max-records`.
5. `--backup-dir` is an absolute path outside the repository, with approved ACL/encryption
   and retention policy.
6. `--confirm` exactly matches the confirmation string printed by dry-run.
7. `ATTENDANCE_DATA_FIX_DATABASE_URL` is set intentionally.
8. Both `payroll_reports` and `payroll_period_locks` guard tables are available; apply fails closed if either table cannot be verified.
9. Any draft/open payroll overlap requires separate finance acknowledgement before tooling
   may be widened. Current tooling does not bypass this block.

The dry-run `planHash` binds the date range, business context, categories, owner, reason,
current candidate before/after values, detected payroll impact, git SHA, script SHA-256,
script version, and DB fingerprint. The approval manifest records DB role separately,
but the role is not part of `planHash` so the reviewed read-only dry-run can be applied
through the separately approved write role against the same database fingerprint.

Apply runs inside a `SERIALIZABLE` transaction with short `lock_timeout`, statement timeout,
payroll gate table locks, read-back verification, and a repeated payroll gate check before
`COMMIT`. If the `COMMIT` result is ambiguous, the script reconnects and checks operation
audit evidence; it does not rerun apply automatically.

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
  --max-backup-bytes 26214400 \
  --review-token <dry-run-planHash> \
  --backup-dir <absolute-secure-backup-dir-outside-repo> \
  --confirm "<exact-confirmation-from-dry-run>"
```

Before production apply, approve backup handling explicitly:

```text
APPROVE HISTORICAL ATTENDANCE BACKUP POLICY

Storage location:
Encryption/ACL:
Retention period:
Backup owner:
Restore drill completed: yes/no
Personal data handling approved by:
```

## Backup and audit trail

Before `UPDATE`, apply mode exports a checksumed JSON backup artifact containing:

- targeted `hr_time_records`;
- related `hr_audit_log` rows;
- matching `payroll_reports` rows for impacted staff/months;
- matching `payroll_period_locks` rows;
- matching `payroll_entries` rows;
- matching `salary_adjustments` rows;
- matching salary `finance_transactions` rows;
- planned before/after changes;
- dry-run `planHash`;
- approval scope and owner.

The backup writer requires an absolute directory outside the repository, refuses symlinked
path segments, writes through a temporary file, fsyncs the file, atomically renames it, and
records a SHA-256 checksum plus row counts in the artifact manifest. The database audit log
stores only the artifact ID and checksum, not the operator's local absolute backup path.

Every changed attendance row also gets an `hr_audit_log` entry with action:

```text
attendance_historical_grace_data_fix
```

The audit row stores `approved_by` and `executed_by` separately. The database
`performed_by` value uses the bounded `executed_by` actor.

Apply also writes one operation-level audit row:

```text
attendance_historical_grace_data_fix_operation
```

## Rollback instructions

Rollback is a separate write-mode operation and requires owner approval. Use the tested CLI:

```bash
node scripts/rollback-attendance-historical-grace.js \
  --backup-file <absolute-backup-json> \
  --plan-hash <applied-planHash> \
  --executed-by "<operator name>" \
  --reason "<rollback reason>" \
  --format markdown
```

Rollback dry-run verifies the backup checksum and confirms current row values still match
the applied after-values. Apply requires the exact confirmation printed by the dry-run:

```bash
ATTENDANCE_DATA_FIX_DATABASE_URL=<write-db-url> \
node scripts/rollback-attendance-historical-grace.js \
  --apply \
  --backup-file <absolute-backup-json> \
  --plan-hash <applied-planHash> \
  --executed-by "<operator name>" \
  --reason "<rollback reason>" \
  --confirm "ROLLBACK_ATTENDANCE_HISTORICAL_FIX_<planHash-prefix>"
```

Safe rollback strategy:

1. Stop and preserve the backup JSON created before apply.
2. Confirm the `planHash`, checksum, date range, owner, and categories match the applied run.
3. Restore only `hr_time_records` fields from the backup:
   - `status`;
   - `late_minutes`;
   - `overtime_minutes`.
4. Do not rewrite payroll reports or payroll periods during rollback unless finance explicitly approves it.
5. Insert new `hr_audit_log` row-level and operation-level actions describing the rollback.
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
| Tooling guard update | v3 narrows late candidates to `late_minutes 1..5`, refuses write/generic DB URLs for dry-run, adds `--max-records`, compare-and-set updates, canonical approval manifest, serializable apply, payroll table locks, read-back verification, durable checksumed backups, operation audit, and rollback CLI. |
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
