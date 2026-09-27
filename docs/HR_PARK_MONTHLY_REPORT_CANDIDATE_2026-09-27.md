# EG-HR-18 — Park monthly attendance/KPI report candidate

## Scope and source decision

At the start of this work, the live `/api/version` reported `0.82.21`,
`codex/eventgenix-production`, commit `acbd1f62ed51ce16b6b0469023f4225c8bef6d7a`.
The worktree started from remote production
`3c8aff0c88c468d82edf383467b1fe794323a43d`. Before feature push,
production advanced to `81717114a1eaa55d9fc976e80b29099211d8f2b0`
(`0.82.22`, organization-owner creation); that history was merged normally
into this feature. The live site still reported `0.82.21` at that check.

The existing monthly handler reads staff rates, profession rates, payroll schemes,
payroll attendance allocations and task KPI without a business-context filter.
It is retained for its existing access boundary. The Park recovery is a separate,
exact `GET /api/hr/report/monthly` lane requiring current single-business Park
membership, matching active business and organization IDs, and `hr.reports.view`.
It does not authorize HEAD, export, salary, payroll profiles, account options or
writes. Park receives a report with attendance and Park-context linked-staff task
metrics only. Its SQL does not read compensation sources, and its final response
uses an explicit field allowlist with `exportAllowed: false`.

The owner decision in `docs/PARK_STAFF_SCHEDULE_READ_RECOVERY.md` assigns the
existing staff and schedule namespace to Park. A production aggregate audit at
`2026-09-27T10:58:17Z` used `eventgenix_audit_ro` in a `REPEATABLE READ READ ONLY`
transaction, without any new grants or data changes:

| Check | Aggregate |
| --- | ---: |
| Existing staff | 217 |
| Shift/time records without staff | 0 / 0 |
| Park-context tasks with an owner | 1257 |
| Other or unknown-context tasks excluded by SQL | 4 |
| Park-context tasks without an active staff profile | 179 |
| Park-context task links to missing staff | 0 |
| Owners with multiple distinct active staff profiles | 0 |

The 179 unlinked tasks are excluded from per-person KPI; they do not change the
ownership of staff. They are a metric-coverage limitation and should be reviewed
before treating this report as a complete task workload ledger. The audit script
`scripts/audit-park-hr-monthly-ownership.cjs` emits aggregates only and requires
`PRODUCTION_READONLY_DATABASE_URL`; it must be run with the dedicated read-only
role, never with the application or admin connection. The same read-only
transaction successfully `EXPLAIN`-validated all four report SQL statements
against the production schema without fetching report rows.

## Verification and release gate

The real Express route test covers the allowed viewer, missing capability,
foreign business or organization, revoked and mismatched membership, multi/all
scope, invalid month, 500, exact-method/path isolation and payroll masking.
The UI tests cover 403, 500, offline, retry, export disablement and a late
response after a business change. No production HR or payroll records were
created or changed.

Before the production-base merge, `npm test` passed on Node 22.23.1 and npm
10.9.8. After the merge, the focused route/UI/HR-card/Today suite passed
40/40 tests and `npm run check:version` passed. Exact-SHA CI remains the
automated gate for the merged feature.

This feature branch may be reviewed and run through exact-SHA CI. Production
integration, release version/cache sync, deploy and test-account live QA are
separate gates. Before release, refresh `/api/version`, the production branch
and ownership aggregates; any new ambiguous ownership signal is HOLD.
