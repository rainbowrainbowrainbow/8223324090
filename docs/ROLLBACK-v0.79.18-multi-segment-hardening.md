# Rollback v0.79.18 — Multi-segment hardening

## Release boundary

- Production branch: `codex/performance-hardening`.
- Previous known-good release: `v0.79.17`, commit `d128a4a943788c97ddb48208cb4ab78bfa21df5d`.
- Product commit: `8f55cd96d` (`feat: harden multi-segment scheduling`).

## Application rollback

If the release introduces a blocking application regression, redeploy the previous known-good commit without changing Railway settings or environment variables.

1. Confirm the active Railway source branch is still `codex/performance-hardening`.
2. Prefer a forward revert commit on the same branch; do not force-push or rewrite production history.
3. Run the version smoke and read-only Staff Schedule release verification after the rollback deploy.
4. Keep the additive `hr_shift_segments` and `hr_shift_segment_roles` tables in place.

## Data safety

- Do not drop segment tables, delete production segments, or rewrite existing segment IDs during an emergency rollback.
- The legacy parent envelope and primary profession remain available to the previous application version.
- Do not run HR reconciliation apply mode during rollback. Dry-run is read-only and may be used for diagnostics.
- Do not approve payroll, create finance transactions, or alter customer bookings as part of rollback verification.

## Post-rollback checks

- `/api/version` and login HTML report the rollback version.
- Existing single-shift and multi-segment days still open through compatibility fields.
- Staff Schedule GET remains read-only.
- Attendance row counts, payroll previews, and booking records are unchanged.
