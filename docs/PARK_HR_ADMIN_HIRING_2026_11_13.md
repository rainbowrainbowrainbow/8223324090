# Park HR administrator and hiring release preparation

## Scope and authorization

The owner approved RED-PARK-HR-ADMIN-HIRING for local access changes, additive migration preparation and synthetic verification.
The working branch is codex/park-hr-admin-hiring-20261113.
Production 0.83.51 (1d283db4) was merged into this branch, including the released waiter schedule landing behavior.

## Confirmed defects

- A profession-only staff PUT was classified as a payroll mutation because role_type and secondary_professions were included in STAFF_PAY_FIELDS. Administrators without payroll rules received a denial.
- Opening a staff card called replaceChildren on the secondary profession picker, removing its search, chips and option containers. Catalog hydration could not reconstruct these controls.
- The card header retained its previous profession after a Work save. It now refreshes from the saved staff record.
- The Work tab requested role assignments through a payroll-only read path. Nonfinancial assignment metadata now has a staff-management read lane with an explicit response field projection.
- Administrator team navigation hid reserve and blacklist. Park administrators now see all five existing buckets while other business presets retain their existing visibility.
- Hiring routes were behind the legacy shared-staff guard. They now require Park membership or the existing Park compatibility contract and check vacancy ownership for application and resume access.
- Empty vacancy results and failed list requests left the status filter unbound. The filter now supports changing status or retrying from either state.
- Existing candidates now have an interview result editor. Hired applications cannot be moved to another stage through a stale interface or a concurrent status request.

## Ownership and migration

Migration 394_hr_vacancy_business_ownership.sql adds a nullable business_context column and a business/status index.
New vacancies receive server-selected event_genix ownership. The production audit on 2026-11-13 confirmed six unassigned vacancies (IDs 1–6), zero applications and zero resume files. The owner confirmed that the historical records belong to Park and approved the bounded data fix under RED-PARK-HR-HIRING-OWNERSHIP.
The UI reports pending ownership instead of presenting an unexplained empty list.
scripts/audit-hr-hiring-ownership.js uses HR_HIRING_AUDIT_DATABASE_URL with a read-only transaction and emits aggregate counts only.
After schema deployment, apply docs/releases/park-hr-hiring-ownership-data-fix.sql separately with an authorized operator connection and verify the updated inventory. The transaction aborts on inventory drift and can be repeated after successful application.

Production ends at migration 393. This release takes the next number because the parallel freelance candidate is idle, local-only and based on an older release. If Park HR ships first, rebase and renumber the freelance candidate before its release. Recheck both candidates before push. No migration was applied to production by this task.

## Verification evidence

- Focused permission, payroll, staff-card, profession UI and sidebar tests passed on Node 22.
- The hr-hiring isolated PostgreSQL mode covers administrator profession changes, ownership-selected vacancy creation, applications, resume upload/download, mismatched parent denial, hiring, duplicate hiring, foreign context denial and an explicit management denial.
- HR_HIRING_BROWSER=true passed against the migrated app at 1366 light and 390 dark. It verified all five team buckets, primary profession changes, adding/removing a secondary profession, saved header updates and SQL/API persistence.
- Migration application twice preserved the unknown owner of an existing synthetic vacancy. The read-only aggregate audit succeeded both before and after adding the ownership column.
- Earlier full npm test passed before the newly authorized access and schema changes. A complete current-candidate pass remains required after migration ordering is resolved.
- Current execution logs and screenshots are under output/hr-admin-focused.log, output/hr-hiring-actual-browser.log and output/playwright/hr-hiring-actual.

## Release prerequisites

Resolve migration ordering, run the current candidate gates, prepare an exact-SHA release manifest and obtain the bounded production authorization. The alternate test credential source was approved for read-only audit and test login, and a production test login succeeded.
Rollback must retain the ownership column and any ownership evidence written by a separately approved data fix.
