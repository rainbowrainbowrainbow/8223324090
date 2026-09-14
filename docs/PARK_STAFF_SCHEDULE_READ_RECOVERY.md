# Park staff schedule read recovery

## Incident and owner decision

On 2026-09-14, the production `0.81.165` deployment
(`bc354511fb322987494b16702d5344f04007132b`) returned
`403 staff_not_migrated` for both `/api/staff?active=true` and
`/api/staff/schedule?from=2026-09-13&to=2026-09-21`. Explicitly selecting
`event_genix` produced the same result. The membership cutover correctly
contained the global staff/HR namespace, but made the existing Park schedule
unavailable.

The owner explicitly confirmed that **all existing staff records and schedule
history belong to Park**, and authorized the bounded
`STAFF-SCHEDULE-READ-RECOVERY` change. That decision assigns this existing
namespace to `event_genix`; account membership, a default database column, and
department names are not used to infer data ownership.

## Recovery boundary

- Only the staff and HR routers explicitly opt into the recovery through
  `requireLegacyBusinessSurface`'s `parkScheduleRouter` option.
- Recovery requires a fresh, valid, single-business Park membership; registry,
  membership and resolved active business must agree on organization/business
  IDs. The existing `hr.schedule.view` permission remains required. Existing
  endpoint-specific permission checks continue to run.
- Allowed staff GET paths: roster, departments, display groups, schedule,
  schedule hours, attendance and a specific cell's schedule history.
- The only allowed HR GET path is the professions catalog; its existing
  `hr.staff.view` capability requirement is preserved.
- Recovery projects responses to schedule data. It removes account identifiers,
  compensation payloads and unrelated HR catalog details. Roster and schedule
  responses declare `scheduleAccess.readOnly` to the UI.
- The frontend sends the selected business through the existing authenticated
  request helper. It preserves aborted requests, failure handling and atomic
  date-range confirmation. A read-only response only reduces capabilities;
  it never grants a role a new permission.
- All other membership staff/HR endpoints, mutation verbs, payroll and internal
  legacy service access remain contained. Existing compatibility behavior is
  unchanged. The global staff/HR modules are not advertised as fully migrated.

No schema, historical records, payroll calculations, production configuration,
dependencies or secrets are changed. The Park-only legacy namespace must not be
used to create another business's staff; future shared employment or non-Park
staff requires a separately designed ownership migration.

## Changed files

- `services/parkStaffScheduleAccess.js`: the Park membership and GET-path boundary.
- `services/parkStaffScheduleProjection.js`: schedule-only response fields.
- `services/legacyBusinessSurface.js`: explicit recovery opt-in and response metadata.
- `routes/staff.js`, `routes/hr.js`: opt in without replacing existing endpoint guards.
- `js/staff-page.js`: business-aware reads and server-controlled read-only presentation.
- `tests/park-staff-schedule-access.test.js`,
  `tests/park-staff-schedule-projection.test.js`,
  `tests/park-staff-schedule-routes.test.js`,
  `tests/staff-schedule-business-context.test.js`: focused regressions.
- `tests/browser/staff-schedule-custom-range-browser-smoke.js`: browser recovery coverage.
- `package.json`: the recovery tests join the existing verification command.
- This document records the owner decision, boundary and verification.

## Verification and delivery

`npm run test:staff-schedule-recovery` runs permission/ownership, payload
projection, actual Express route and frontend business-context regression tests.
It is part of `test:sys-mb`, and therefore the normal `npm test` gate.

Checks completed on Node 22.23.1 / npm 10.9.8:

- `npm run test:staff-schedule-recovery`: 29/29 passed on the final implementation,
  including paid-role plan inspection without exposing or requiring hidden rates.
- `npm run test:sys-mb`: passed, including legacy containment, business cabinets,
  lead integrity, domain ownership and the new schedule recovery tests.
- Existing schedule/history/segments/preferences, HR capability and business
  membership/module suites: 87/87 passed using the standard isolated test runner.
- `npm run check:access`, `npm run check:auth-boundary`,
  `npm run check:api-surface`, `npm run check:version`: passed.
- `npm run check:syntax`: 1,250 JavaScript files passed. The initial sandboxed
  attempt could not spawn parser processes; the standard command then passed
  outside that process restriction.
- `node tests/browser/staff-schedule-custom-range-browser-smoke.js`: the full
  Chromium suite passed after the final edits, including the new recovery flow.
  The same script with `--recovery-readonly-only` also passed. The final run used
  the cached Playwright binary on the process-local PATH, without changing
  project dependencies. Browser fixtures use the actual response projection.
  Verified date-range loading, Park context headers, disabled mutations, print
  availability and a paid-role plan with nine physical hours and no false rate
  validation errors. Screenshots `park-recovery-readonly-plan.png` and
  `park-recovery-readonly-summary.png` under
  `output/playwright/staff-schedule-custom-range-smoke/` were visually inspected.
- Final touched-file parser checks and `git diff --check`: passed.

The route fixture uses actual Express routers, capability checks and canonical
read handlers with a synthetic authenticated principal and read-only fake pool.
It does not claim real PostgreSQL or live JWT/session verification. The original
incident was separately reproduced through production login and GET requests.
At local handoff, no full `npm test`, GitHub CI, commit, push, deployment,
database migration or post-deploy live QA had been performed.

The local candidate is based on production upstream
`a9a8f7efe7b166490afc2728b22c5bbc2fe5d608`, isolated from the dirty primary
checkout. The owner subsequently requested production delivery on 2026-09-14.
Release preparation rechecked the live version and production branch:
`0.81.166` at `a9a8f7efe7b166490afc2728b22c5bbc2fe5d608`, with complete manifest
metadata and a matching upstream. The delivery scope is this recovery change,
release markers, exact-SHA CI and read-only live QA. Local verification alone
does not establish that the live site has received the change.

Rollback before delivery consists of omitting this scoped change. A release
must follow the current production runbook and exact-SHA CI gate; the previously
verified live SHA above is evidence, not an instruction to overwrite newer work.
