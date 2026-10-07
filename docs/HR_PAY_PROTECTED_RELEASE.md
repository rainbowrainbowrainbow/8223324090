# HR-PAY protected release

Production impact: yes. Release readiness remains HOLD until all product and test gates pass.

- Workflow: `hr-payroll`; Red exceptions: exactly `routes/payroll.js` and the HR test/evidence changes in `.github/workflows/ci.yml`.
- Migration: exactly `374_payroll_day_exceptions.sql`, schema only, no backfill.
- All candidate paths are literal entries in `HR_PAYROLL_CHANGED_PATHS`; no glob, prefix or other task exception.
- The v0.82.57 release/cache paths and docs/HR_PAY_RELEASE_NOTES.json are individually enumerated from the actual generated diff. Future marker files require explicit review; no wildcard was added.
- Functional commit and a separate Ukrainian version/changelog commit precede manifest creation.
- Manifest binds the prepared release SHA; even another descendant is rejected. No automatic bump after confirmation.
- Live must still match the signed base before execution; remote production must match that base or the same prepared SHA for a CI retry. Foreign production changes stop before push.
- Production execution selects only `ci.yml` / `CI` triggered by a push to the production branch at the exact SHA. All eight required jobs must complete successfully; a skipped job or a green unrelated workflow is rejected. Live/remote drift is checked again after CI, immediately before upload.
- Fixed production identity, six-hour maximum validity, three attempts, exact confirmation and exact-SHA CI remain enforced.
- Production QA is read-only. One-off/attendance/payroll writes run only on synthetic disposable PostgreSQL fixtures.
- Rollback deploys the previous live code while retaining new journal structures and snapshots. No destructive SQL.

## Required evidence before final approval

Full candidate CI, HR-PAY PostgreSQL scenarios, actual-app browser coverage of the completed UI,
Park business-context API availability under existing permissions, next free patch and exact live/remote/Railway identity.
The workflow is authorization plumbing, not a readiness certificate. Do not request approval or deploy while any of these are missing.

## Approved Park access prerequisite (2026-10-03)

The owner separately approved the bounded Park HR/payroll lane in the readiness report.
services/parkHrPayrollAccess.js preserves current membership/capability checks, rejects
unverified attendance ownership and enumerates individual method/path operations only.
Payments, settlement/close mutations, bulk apply and other businesses stay unavailable.
Membership-mode actual-app coverage must report journeyStatus PASS; BLOCKED is not a release pass.
This approval does not authorize production branch drift or replace the final manifest confirmation.

## HR-PAY-12 release preparation

- Prepared version: 0.82.57, «HR: ставки та додаткові професії». The previous approved functional candidate is b7d2248f0ad6f129747248736d0018e28a6d6611.
- Verified base/rollback source: 59d67e9916c0a6ce2f64fcafa08cc9e5ce0e5efc (v0.82.56). Railway deployment reference: b46d7c01-178c-4ff2-8e0f-24e4fb253cdf. Recheck live and remote again before execution.
- Rollback retains migration 374, payroll_day_exceptions and all attendance/payroll snapshots. No down migration, backfill or historical recalculation.
- The existing release helper rejects an older version, non-descendant SHA and mismatched remote HEAD. Do not claim that uploading the old SHA through the normal helper is supported. Safe code recovery is a forward commit restoring the pre-HR runtime from the recorded base, retaining migration 374 and data, with a fresh patch, exact-SHA CI and a new reviewed manifest. Never force-push or bypass those guards. This preparation does not execute recovery.
- The existing controller signs createdAt/validUntil and expires no later than six hours after preparation, which is stricter than six hours after a later confirmation. Prepare only after CI; display the exact deadline. Do not extend/re-sign the manifest or fabricate a confirmation. An expired manifest needs fresh preparation and its own human confirmation.
- Production QA remains read-only. allowedQaScope.enabled=false disables the controller's writable fixture canary; it does not certify HR product QA. HR-PAY-13 must perform the separate authorized read-only HR/schedule/access checks.
- Exact release SHA, final CI, reviewed browser artifacts, live/remote/Railway identity and the generated manifest path are recorded in output/hr-pay/hr-pay-12-final-proof.json. No production push/deploy is permitted until the real user supplies the exact generated confirmation.
