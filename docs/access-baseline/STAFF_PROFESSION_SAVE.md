# Staff profession save regression

Owner report: an administrator cannot save additional professions/admissions,
while the creator can. Investigation date: 2026-11-18.

## Cause and decision

`saveStaffRoleAssignments` sent `hourly_rate` on every assignment, including
profession-only edits. The membership guard classified every PUT to
`/api/hr/staff/:id/role-assignments` as payroll-rules management. The admin preset
has staff management but intentionally does not have payroll-rules management.
The request therefore returned `PARK_HR_PAYROLL_ACCESS_DENIED`.

The roles button now submits profession/admission metadata only. A strict server
allowlist routes that payload through existing staff-management and profile-edit
checks, retaining active Park membership, writable business scope and explicit
denials. Financial or unknown fields, including nulls, retain the payroll guard.
No role receives a new payroll capability.

The metadata transaction changes primary/secondary professions and assignment
statuses. Retained assignments preserve IDs, rates, payroll schemes and notes.
It does not update staff hourly rates, profession rates or payroll schemes.
It returns the new profile revision and clears only submitted profession fields
from the work-section dirty baseline; unrelated drafts remain dirty.

## Verification boundaries

Tests use synthetic users and staff in a loopback disposable PostgreSQL database.
The reported administrator and employee were not queried or changed. Live QA
requires the approved local credentials file, which is currently unavailable.

The live service and production branch were observed at version 0.84.2,
`bad00fa51592b12e2ef9b37cae5422b312146f12`. This fix is local and has not been
pushed or deployed. Existing whole-baseline release gates remain in force.

Modern Web Guidance `forms` informed the explicit-save behavior and server-side
input validation. Existing loading/error notifications, native select controls,
keyboard behavior and pending-action handling are retained. No new browser APIs
or dependencies are introduced.
