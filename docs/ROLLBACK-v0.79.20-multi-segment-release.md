# Rollback v0.79.20 — Безпечний multi-segment графік

## Release boundary

- Production branch: `codex/performance-hardening`.
- Previous known-good release: `v0.79.19`, commit `7abf9cd2092393f83034f38b68905d79f9eadb05`.
- Product commit: `5c5091a2b` (`fix: complete multi-segment scheduling hardening`).
- Railway settings, secrets and deploy branch configuration are outside this rollback.

## Application rollback

If the release introduces a blocking application regression, deploy a forward revert on the same confirmed production branch. Do not force-push or rewrite production history.

1. Read-only confirm that Railway still deploys `codex/performance-hardening`.
2. Revert the application/release commits and push the forward revert to the same branch.
3. Do not change Railway project settings, environment variables, secrets or branch ownership.
4. After deploy, run the version smoke and read-only Staff Schedule verification.
5. The UI/API may temporarily return to single-shift read compatibility mode, but legacy writes must remain blocked for existing multi-segment days.

## Data safety

- Do not drop `hr_shift_segments` or `hr_shift_segment_roles`.
- Do not delete production segments, rewrite segment IDs or flatten multi-segment plans.
- Keep additive segment data in place even when an older application version reads only the parent envelope.
- Do not run HR reconciliation apply mode during rollback. A dry-run may be used only for read-only diagnostics.
- Do not approve payroll, create finance transactions or modify customer booking records during verification.

## Post-rollback checks

- `/api/version` and login HTML report the rollback version.
- Staff Schedule GET remains read-only and existing days still open through compatibility fields.
- Counts of `hr_shifts`, `hr_time_records` and working days are unchanged.
- Attendance row counts, payroll previews and booking records are unchanged.
- Disposable QA fixtures are removed or soft-archived, with cleanup confirmed by a separate read-only check.
