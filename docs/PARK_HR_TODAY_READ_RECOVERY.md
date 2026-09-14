# Park HR Today read recovery

## Bug report

On 2026-09-14, the owner reported the same load failure in the Today tab after
Park schedule recovery. A read-only test-account probe against production
`0.81.167` / `48f03e9b9ff3aa0c13a935fe324fa675ea47995b` confirmed:

- `GET /api/hr/today`: HTTP 403, `staff_not_migrated`.
- `GET /api/hr/professions` and `GET /api/staff?active=true`: HTTP 200.
- All requests explicitly selected the `event_genix` single-business context.

Expected: an authorized Park user sees today's staff, planned shifts, attendance
and counters. Actual: the separate Today endpoint remained outside the previous
schedule-only read allowlist and never reached its database handler. Its frontend
also fetched unrelated account links before the primary Today request.

## Authorized scope and implementation

The owner previously confirmed all existing staff/schedule history belongs to
Park, requested production delivery, and then requested the same recovery for
Today. This follow-up extends that read-only recovery to one endpoint. It is not
authorization for attendance writes, payroll, broad HR activation, database
migrations, production settings, secrets or another business's access.

- The existing Park membership/organization checks are reused for `GET /hr/today`.
- Today requires its own `hr.today.view` capability. It does not borrow schedule
  or HR-card permissions, and it preserves the route's existing capability check.
- The existing handler and read-only query/hydration flow stay unchanged.
- A dedicated response projection preserves roster labels, shift plans, factual
  attendance and the six summary counters; it excludes birth dates, account/contact
  details, compensation snapshots and pay values.
- Successful recovery responses declare `todayAccess.readOnly`. The frontend uses
  this response-scoped state to omit writes and unrelated account/card reads;
  user capabilities remain unchanged.
- Other staff/HR endpoints and mutation verbs retain their existing restrictions.

## Files and verification

Backend changes are in `services/parkStaffScheduleAccess.js`,
`services/parkStaffScheduleProjection.js` and `services/legacyBusinessSurface.js`.
Today UI changes are in `js/hr-page.js`. Focused access/projection and actual-router
tests, frontend tests and the existing Today browser smoke cover the recovery.

The initial targeted tests reproduced two failures: missing Today access and
missing Today response projection. After the backend fix, all 15 access/projection
tests passed on Node 22.23.1 / npm 10.9.8. The complete local `npm test` also
passed after integrating the concurrent Dashboard release. Its recovery suite
contains 45 passing tests, including six Today frontend tests and seven actual
Today router tests. The full existing Today Chromium smoke plus the new recovery,
filters, counters, error/retry and desktop/mobile scenarios passed; synthetic
screenshots were inspected. Production delivery additionally requires the exact
candidate SHA's GitHub CI, manual Railway helper, exact version proof and
read-only live Today plus schedule regression QA.

The candidate worktree started at `48f03e9b9ff3aa0c13a935fe324fa675ea47995b`.
The concurrent production Dashboard release `0.81.168` at
`44e9a2cdb3bf27010021f21b4e71549b8acd5fb4` was merged without conflicts; its
changes are preserved. The functional Today commit is `f2ee9c212`.
No migration rollback is needed. A functional rollback should revert only this
follow-up through a new reviewed patch release, preserving the previous schedule
recovery and shared production history.
