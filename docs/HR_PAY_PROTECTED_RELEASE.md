# HR-PAY protected release

Production impact: yes. Release readiness remains HOLD until all product and test gates pass.

- Workflow: `hr-payroll`; Red exception: exactly `routes/payroll.js`.
- Migration: exactly `374_payroll_day_exceptions.sql`, schema only, no backfill.
- All candidate paths are literal entries in `HR_PAYROLL_CHANGED_PATHS`; no glob, prefix or other task exception.
- Release/cache marker paths must be enumerated from the prepared release diff before final preparation.
- Functional commit and a separate Ukrainian version/changelog commit precede manifest creation.
- Manifest binds the prepared release SHA; even another descendant is rejected. No automatic bump after confirmation.
- Live must still match the signed base before execution; remote production must match that base or the same prepared SHA for a CI retry. Foreign production changes stop before push.
- Fixed production identity, six-hour maximum validity, three attempts, exact confirmation and exact-SHA CI remain enforced.
- Production QA is read-only. One-off/attendance/payroll writes run only on synthetic disposable PostgreSQL fixtures.
- Rollback deploys the previous live code while retaining new journal structures and snapshots. No destructive SQL.

## Required evidence before final approval

Full candidate CI, HR-PAY PostgreSQL scenarios, actual-app browser coverage of the completed UI,
Park business-context API availability under existing permissions, next free patch and exact live/remote/Railway identity.
The workflow is authorization plumbing, not a readiness certificate. Do not request approval or deploy while any of these are missing.
