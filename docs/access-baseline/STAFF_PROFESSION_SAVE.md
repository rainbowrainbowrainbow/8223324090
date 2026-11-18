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

Changed implementation files: `js/hr-page.js`, `routes/hr.js`,
`services/staffProfessionAssignments.js`, `services/parkHrPayrollAccess.js` and
`services/parkHrStaffWorkflowAccess.js`. Tests are in
`tests/staff-profession-assignments.test.js`,
`tests/integration/park-hr-staff-professions.test.js` and
`tests/browser/staff-professions-actual-app-smoke.js`. `package.json` includes the
regression in the standard staff-schedule recovery suite; the isolated runner
has explicit API/browser modes. Dependency versions and lockfile were not changed
by this fix.

## Verification boundaries

Completed checks:

- Full `npm test` on upstream c6d88d91: PASS, exit 0, Node 22.23.4/npm 10.9.9.
  Unit 4036/4036, My Day 338/338, automation 54/54, UI 1324/1324 and syntax
  1788 files. Evidence: `output/staff-professions-current-base-npm-test.log`.
- Focused staff-workflow, submission-boundary and unit-runner checks: 17/17.
- Fully migrated disposable PostgreSQL API regression on upstream c6d88d91: 1/1
  compound test, no skips. Admin/creator primary and secondary profession saves,
  admission changes, new profession addition, retained non-null payroll scheme
  and rates, explicit denials, revoked/stale/inactive membership, foreign/all
  business scopes and financial-field injection are exercised. The creator's
  separately authorized financial update still works.
- Actual app in Chrome on the same upstream: 4/4, admin/creator at 1280 and 390 px.
  Native primary selection, real additional-profession/search/save clicks, saved
  admission, header update and unchanged stored hourly rate were verified. Both
  the roles button and subsequent work-section footer save returned 200; the
  companion shift-preference PUT also returned 200. The second save preserved
  admission and compensation and used the fresh revision without a 409. All
  four final screenshots were reviewed; no visual baseline change was accepted.
- Evidence: `output/staff-professions-targeted.log`,
  `output/staff-professions-current-base-api.log`,
  `output/staff-professions-both-buttons-browser.log`, and
  `output/staff-professions-browser/report.json` plus screenshots.

Tests use synthetic users and staff in a loopback disposable PostgreSQL database.
The reported administrator and employee were subsequently identified uniquely by
the approved read-only production audit. Their actual rights confirm the payroll
payload mismatch and allow the candidate metadata-only save. No real save or
impersonation occurred. Owner-provided relocated credentials are available; the
old Plotva path is no longer a blocker. See PRODUCTION_AUDIT_20261118.md.

The live service and production branch were initially observed at version 0.84.2,
`bad00fa51592b12e2ef9b37cae5422b312146f12`. This fix is local and has not been
pushed or deployed. Existing whole-baseline release gates remain in force.

During verification the production branch advanced to 0.84.3,
`c6d88d91bdc331e124ac07938e3d551563c3d8f6`. The candidate was rebased onto
that exact upstream, retaining shared-session fixes and freelance-reserve handling
alongside the existing team-scope guards. The package inherits 0.84.3; this does
not reserve a release version for this patch.
The final read-only live-version and remote-ref check both matched c6d88d91.

Modern Web Guidance `forms` informed the explicit-save behavior and server-side
input validation. Existing loading/error notifications, native select controls,
keyboard behavior and pending-action handling are retained. No new browser APIs
or dependencies are introduced.

Source: [Modern Web Guidance: forms](https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/forms/forms.md).

The candidate is now integrated onto0.84.6/b0f6077d, preserving upstream freelance
and task-assignment changes. Final actual-app administrator/creator1280/390 saves
pass4/4 (output/baseline-0846-professions-browser.log), with compensation and
admissions preserved. This remains local proof; production delivery and disposable
live validation require the final authorization envelope.
