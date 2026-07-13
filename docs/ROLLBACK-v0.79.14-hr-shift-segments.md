# Rollback note: v0.79.14 - HR shift segments

Production impact: yes.

This is an operator plan only. Run it only after an explicit production rollback decision.

## Release scope

- Release version: `0.79.14`.
- Release label: `Кілька ролей і часових блоків у зміні`.
- Product commit: `33925140e` (`feat: add multi-segment HR shifts`).
- Deploy branch: `codex/performance-hardening`.
- Database migration: `287_hr_shift_segments.sql`.

## Safe rollback boundary

The application UI and API may be returned to the previous single-shift behavior. The additive tables `hr_shift_segments` and `hr_shift_segment_roles` must remain in production, including all segment rows already written by v0.79.14.

Do not:

- run the SQL in the migration `ROLLBACK` comment against production;
- drop either segment table;
- delete or collapse production segments;
- remove migration 287 from `schema_migrations`;
- approve payroll or create finance transactions while rollback verification is in progress.

The legacy columns on `hr_shifts` and `staff_schedule` continue to contain the primary profession and compatibility envelope. Therefore the previous application can read a single-shift representation while the normalized segment data remains available for a later corrected release.

## Application rollback flow

After confirming the current production commit and all dependent commits, create a reviewable rollback commit on the active deploy branch. Prefer reverting the product commit while keeping the additive database state.

```powershell
git status --short --branch
git fetch origin
git checkout codex/performance-hardening
git pull --ff-only origin codex/performance-hardening
git revert --no-commit 33925140e
npm run version:bump -- patch --label "Rollback HR shift segments"
npm run check:runtime
npm run check:migrations
npm test
git status --short
git commit -m "revert: return HR schedule to single shifts"
git push origin codex/performance-hardening
```

If the product commit was cherry-picked and has a different hash on the deploy branch, revert that deploy-branch hash instead. If later commits depend on the segment contract, revert them together in reverse order and resolve conflicts without changing the protected booking identity fields.

## Required post-deploy checks

- `/api/version` and the login release badge show the rollback release.
- Existing legacy and v0.79.14-created days open through the compatibility envelope.
- Creating and editing a single shift still writes one `hr_shifts`, one `staff_schedule`, and at most one `hr_time_records` row per staff/date.
- Attendance and payroll preview totals for existing single-role QA records match the pre-release baseline.
- Segment tables and their production rows still exist and are not modified by the rollback.
- No real booking, payroll approval, finance transaction, or customer record is changed during verification.

If the previous application cannot safely read a multi-segment day through the legacy envelope, stop the rollback and deploy a forward compatibility fix. Do not repair the problem by deleting segment data.
