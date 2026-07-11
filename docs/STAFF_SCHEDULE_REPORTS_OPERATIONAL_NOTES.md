# Staff, Schedule, And Reports Operational Notes

Date: 2026-06-29
Status: current implementation handoff
Production impact: yes

This document describes the current staff/schedule/reports behavior after the
HR-card, schedule grouping, reports staff-id, operations, forecast, and
accountability work. It is intentionally operational, not a full architecture
book.

## Source Areas

- Staff schedule page: `staff.html`, `js/staff-page.js`, `routes/staff.js`
- HR staff cards: `hr.html`, `js/hr-page.js`, `routes/hr.js`
- Reports workspace: `reports.html`, `js/reports-page.js`, `routes/reports.js`
- Reception/managers operations view: `center.html`, `js/center-page.js`,
  `routes/center.js`
- Regression anchors:
  - `tests/staff-schedule-history-static.test.js`
  - `tests/hr-profession-readiness-static.test.js`
  - `tests/reports-workspace.test.js`
  - `tests/backoffice-foundation-v2.test.js`

## Canonical Staff-Card Flow

The operational employee flow is:

`candidate -> hire -> HR card -> account link -> schedule -> shift -> attendance -> report/payroll -> offboarding`.

Current staff-card sources:

- `/api/hr/staff` is the richer HR staff-card source for HR workspace behavior.
- `/api/staff?active=true` is the schedule-safe light staff-card contract used
  by the staff schedule and reports staff selector.
- The light card is based on `staff`, with account presence from
  `employee_profiles`, face readiness from `staff_face_descriptors`, and
  profession data from `role_type` plus `secondary_professions`.

Current `/api/staff?active=true` behavior:

- Filters `staff.is_active = true`.
- Excludes `hr_pool_status = blacklisted`.
- Excludes `is_freelance = true` by default.
- Includes freelance rows only with `include_freelance=true` or
  `includeFreelance=true`.
- Returns `card_source = hr_staff_card_light`.

Light-card fields currently include:

- Identity and display: `id`, `name`, `display_name`, `photo_url`, `color`
- Work metadata: `department`, `position`, `role`, `role_type`,
  `secondary_professions`, `professions`
- Operational status: `is_active`, `is_freelance`, `hr_pool_status`
- Readiness flags: `has_face_descriptor`, `has_account`
- Current compatibility fields: `account_user_id`, `account_username`

Sensitive fields that must not be added to the schedule light card:

- Documents or personal document metadata
- Medical information
- Private salary/payroll scheme values
- Passwords, tokens, secrets, reset links, session data
- Full personal profile data such as address or emergency contacts

Security note:

- `account_user_id` and `account_username` are present today for compatibility,
  but the schedule row only needs `has_account`. A security review flagged those
  fields as potentially sensitive. Prefer removing or role-gating them in a
  separate approved security patch.

## Stored Department Vs Display Category

Do not treat schedule display categories as database departments.

Stored data:

- `staff.department` remains the raw database value.
- The schedule display layer does not migrate or rewrite department values.
- Security staff can still be stored as `department = security`.

Display grouping:

- `services/staffDisplayGroups.js` is the schedule/display grouping authority.
- `scheduleDisplayDepartmentKey(staff)` is the frontend adapter and legacy fallback.
- HR company structure nodes may expose `displayGroup` metadata for operator-visible
  filter ownership. Missing metadata falls back to the canonical service rules.
- `role_type in reception, manager, senior_manager` displays under
  `reception`.
- `department = security` displays under `tech`.
- Everyone else displays under their stored department, with `admin` as the
  fallback.

Top-level display order:

1. `animators`
2. `trampoline`
3. `reception`
4. `admin`
5. `cafe`
6. `tech`
7. `cleaning`

Display labels:

- `reception` -> `Рецепшен`
- `tech` -> `Технічний відділ`
- `security` is not a top-level schedule category.

Subgroups:

- `reception`
  - `Рецепція`: `role_type = reception`
  - `Менеджери`: `role_type = manager` or `senior_manager`
- `tech`
  - `Технічний відділ`: `department = tech`
  - `Охорона`: `department = security`

Areas that should use display grouping:

- HR Today chips and visible staff filters
- Schedule department chips and visible row filters
- Schedule row grouping
- Summary counts
- Load view
- Fill-week modal
- CSV/Excel export labels
- Schedule health diagnostics and row/cell badges
- Staffing forecast diagnostics
- Manager accountability diagnostics

Known limitation:

- Backend endpoints that receive `department` usually operate on raw
  `staff.department`. Do not pass virtual display groups such as `reception` or
  display `tech` to raw-department copy or bulk operations unless the endpoint
  explicitly supports it.

## Copy-Week For Virtual Categories

Copy-week has two modes:

- `raw_department`: allowed only for raw-safe departments:
  `animators`, `trampoline`, `cafe`, `cleaning`.
- `explicit_staff_ids`: used for display or mixed categories:
  `reception`, `tech`, `admin`.

Current frontend behavior:

- `all` copies all visible active operational staff as before.
- Raw-safe department filters send `department`.
- Virtual/mixed display categories send `staffIds[]` from the visible schedule
  rows and a `displayGroup`.
- Dry-run preview returns `count`, `conflicts`, `staffCount`, `copyMode`,
  `displayGroup`, and optionally copied `staffIds`.

Current backend guardrails:

- `POST /api/staff/schedule/copy-week` accepts either raw `department` or
  explicit `staffIds[]`, not both.
- Raw `department` is rejected unless it is allowlisted.
- Explicit `staffIds[]` is capped and validated.
- The route writes schedule audit entries with `copyMode`, `displayGroup`,
  `staffCount`, and `conflictCount`.
- Existing target-week entries for affected staff/date cells are overwritten by
  the copy operation.

## Schedule HR-Card Row Rendering

Schedule rows render as light HR cards, not static text rows.

Expected row data:

- Avatar/photo or initials fallback
- Full name
- Role/position
- Profession summary
- Readiness badges for account, face descriptor, and HR/training readiness
- Freelance marker only when freelance mode is explicitly enabled
- Link to the real HR profile context

Implementation rules:

- Keep schedule row rendering on the light-card payload.
- Do not fetch full private HR profile data just to render the schedule table.
- Preserve sticky first column, keyboard behavior, and existing schedule cell
  interactions.
- Escape names, roles, notes, and badge labels before inserting into HTML.
- Sanitize or normalize photo URLs defensively when expanding this area.

## Schedule Health

Schedule health is passive. It warns managers but does not block editing.
The primary schedule flow should keep the table immediately after the schedule
controls, department filters, and summary; any large health panel belongs to
diagnostic-only UI outside the pre-table path. Table-level badges and readiness
signals may remain in rows/cells.

Severity levels:

- `critical`
- `warning`
- `info`
- `ok`

Score behavior:

- Starts from 100.
- Penalties are currently `critical = 18`, `warning = 6`, `info = 2`.
- Scores are calculated for the visible schedule, by day, and by display
  department.

Current health rules include:

- Staff inactive but visible
- Staff blacklisted, offboarded, dismissed, or terminated
- Freelance/placeholder row visible without explicit freelance mode
- Missing CRM account
- Missing face descriptor
- Missing or low training/readiness
- Staff without role/profession
- Planned inactive/offboarded staff
- Shift without profession
- Shift profession mismatch against HR-card professions
- Long shift over 12 hours
- Duplicate shift rows
- Overlapping shifts
- Work shift conflicting with day off/vacation/sick
- Department below minimum visible staffing for the day
- No responsible manager on a day with visible work

Known limitations:

- Health is a local schedule-quality layer. It is not an approval system yet.
- Department minimums are simple constants, not demand-aware rules.
- Some warnings can be noisy while staff-card readiness data is incomplete.
- Health only reflects data loaded into the schedule view and current filters.

## Attendance And Payroll Reconciliation

Attendance links planned shifts to actual presence without adding a new schema.

Current attendance source:

- `GET /api/staff/attendance?from=YYYY-MM-DD&to=YYYY-MM-DD`
- Reads `hr_time_records` and `staff_checkins`.
- Uses `FULL OUTER JOIN` to combine time records and check-in records.
- If attendance tables are missing, returns an empty result with
  `source = missing_attendance_tables`.

Schedule attendance statuses:

- `planned`
- `checked_in`
- `late`
- `absent`
- `left_early`
- `completed`
- `manual_review`
- `excused`

Schedule UI behavior:

- Shows planned vs actual indicators in cells.
- Highlights late and absent states.
- Shows a daily attendance summary.
- Provides manager actions for supported manual attendance updates.

Reports/payroll reconciliation:

- Payroll tables load schedule and attendance sources for the payroll date
  range.
- Reconciliation stays inside report `rawData`; there is no new report schema.
- The reconciliation source marker is
  `reports_rawData_payroll_reconciliation_v1`.

Payroll row fields can include:

- `staff_id` / `employee_staff_id`
- `display_snapshot`
- `role_snapshot`
- `planned_shift_ref`
- `attendance_ref`
- `attendance_status`
- `planned_hours`
- `actual_hours`
- `paid_hours`
- `manual_amount`
- `bonuses`
- `penalties`
- `notes`
- `reconciliation_status`
- `reconciliation_issues`

Payroll statuses:

- `draft`
- `needs_review`
- `reconciled`
- `approved`

Discrepancy rules include:

- Missing staff id
- Missing payroll date
- Staff id present but staff option unavailable/inactive
- Offboarded staff
- Missing planned shift
- Planned shift without attendance
- Actual hours and paid hours mismatch
- Duplicate payroll row for same staff/date
- Missing or zero amount on a non-empty row

Known limitations:

- Reconciliation is explanatory and warning-based. It does not replace finance
  approval or HR payroll-period locking.
- If staff options or attendance API fail, reports keep working with snapshot
  text and warnings.
- Security review flagged full attendance and payroll APIs as sensitive; any
  permission tightening must be approved separately.

## Reports Staff-Aware Fields

Reports support staff-aware columns while keeping legacy text snapshots.

Column contract:

- A staff-aware column uses `type: staff`.
- The visible text snapshot remains in the original text field.
- The canonical id is stored in the configured `staffIdKey`.

Current templates:

- Payroll employee:
  - text snapshot field: `employee`
  - id field: `employee_staff_id`
  - role helper field: `role`
- Operations checklist owner:
  - text snapshot field: `owner`
  - id field: `owner_staff_id`

Legacy behavior:

- Old reports without `employee_staff_id` or `owner_staff_id` still open.
- Snapshot text is preserved on save/reopen.
- Missing staff id creates quality/reconciliation warnings, not a crash.
- If `/api/staff?active=true` fails, the editor falls back to text behavior and
  reports a non-fatal quality issue.

## Report Quality

Report quality checks are informational unless a future business rule decides
to block approval.

Statuses:

- `ok`
- `warning`
- `needs_review`

Current quality issue areas:

- Payroll staff id/date/amount/duplicate/attendance/shift mismatches
- Operations checklist missing owner staff id
- Missing report context
- Missing submitted-by context
- Staff options unavailable

Draft save remains allowed with issues.

## Reception / Managers Operations View

The reception/managers operations center currently lives in the Center module:

- Page: `/center#operations`
- API: `GET /api/center/operations/today`
- Access: inherited from `/center`, which is authenticated and manager-up.
- No new public page or new role mapping was introduced for this view.

Purpose:

- Give reception/managers a dense day-control panel for today's operational
  state, not an HR editing workspace.

Data sources:

- Today's bookings and booking payment status
- Today's schedule and staff status
- Open tasks
- Pending reports
- Operational history
- Handover notes from settings keys
  `center_operations_handover_notes` or `center.operations.handover`

Operational blockers include:

- Staff no-show
- Late staff
- Pending payments
- Unconfirmed bookings
- Overdue tasks
- Pending reports

Known limitations:

- The first version is mostly read-oriented and links out to existing modules.
- Reception-specific access is not granted automatically; current access is
  manager-up through the Center module.
- Any role/access expansion requires explicit approval and synced changes in
  `middleware/auth.js`, `js/auth.js`, and `js/components/sidebar.js`.

## Staffing Demand Forecast

Forecast is an MVP heuristic layer, not auto-scheduling.

Data source:

- Bookings/timeline-style data loaded for the visible schedule range.

Forecast departments:

- `animators`
- `trampoline`
- `reception`
- `managers`
- `tech`
- `cafe`
- `cleaning`

Current assumptions:

- Empty days recommend zero unless active booking demand exists.
- Animators scale with active events, expected children, hosts, and second
  animator signals.
- Trampoline staffing is inferred from booking category, room, or program text.
- Reception and managers scale with booking count and peak-time demand.
- Tech/security scales with active day, weekend/evening/high-volume demand.
- Cafe and cleaning scale from banquet/menu/kitchen/cafe demand and expected
  guests.

Known limitations:

- No machine learning.
- No automatic schedule edits.
- No migration or persistent forecast model.
- The forecast panel is diagnostic-only and is not fetched or rendered by the
  default primary schedule path. If diagnostic forecast data is unavailable, the
  diagnostic UI should show an unavailable/empty state and leave the schedule
  unchanged.

## Manager Accountability

Manager accountability is a read-only operational diagnostic summary. It is not
part of the primary pre-table schedule path.

Manager roles considered:

- `manager`
- `senior_manager`
- `admin`
- `vice_director`
- `art_director`

Current mapping:

- `inferred_from_hr_role_type_same_department`
- A manager can be considered responsible for departments matching their raw
  department or matching display department.
- There is no durable department-manager assignment model yet.

Visible metrics:

- Assigned manager
- Schedule health score
- Open critical/warning issues
- No-shows
- Unresolved attendance
- Missing readiness count
- Late reports, payroll discrepancies, unapproved shifts, weekly trend, and
  last action date are shown as unavailable when the source is missing.

Known limitations:

- Do not invent KPI numbers when sources are missing.
- This is not a penalty system.
- Any explicit department-manager mapping needs a separate data model proposal.

## Security And Access Notes

Current checks passed in the local regression pack:

- `npm run check:auth-boundary`
- `npm run check:access`

Important access constraints to keep in mind:

- `/api/staff/payroll` is role-gated for payroll/HR leadership roles.
- `/api/staff/attendance` is role-gated for manager/staff-management/payroll
  roles because it contains detailed attendance records.
- A future safer model can split full manager attendance data from redacted
  status-only schedule badges for broader staff views.
- `/api/staff?active=true` should avoid expanding beyond light-card fields.

## Verification Pack

Use this pack before release or handoff:

```bash
npm run check:runtime
npm run audit:staff-schedule -- --from 2026-06-28 --to 2026-07-28 --json
node --test tests/staff-schedule-history-static.test.js tests/hr-profession-readiness-static.test.js tests/reports-workspace.test.js
npm run check:theme-surface
npm run test:ui
npm run check:syntax
npm test
```

If the local shell is not Node 22 / npm 10, run through:

```bash
npx -y -p node@22 -p npm@10 -c "npm test"
```

Known environment blocker:

- `audit:staff-schedule` requires a configured PostgreSQL environment through
  `DATABASE_URL` or `PGHOST` / `PGDATABASE` / `PGUSER`.

Live schedule QA:

- Read-only browser smoke:
  `npm run smoke:staff-schedule -- https://<live-crm-host>`
- Controlled write acceptance smoke:
  `npm run smoke:staff-schedule:write -- https://<live-crm-host>`
- The write smoke requires:
  `LIVE_STAFF_SCHEDULE_WRITE_CONFIRM=I_CONFIRM_STAFF_SCHEDULE_QA_WRITES`,
  `LIVE_STAFF_SCHEDULE_QA_STAFF_ID`, and `LIVE_STAFF_SCHEDULE_QA_DATE`.
- Replacement coverage is optional and requires
  `LIVE_STAFF_SCHEDULE_QA_REPLACEMENT_STAFF_ID`.
- Use only QA staff/date cells. The script refuses non-QA-looking staff by
  default, requires an existing primary schedule entry, verifies UI save,
  API persistence, audit history, bulk write, copy-week dry-run, attendance
  read contract, optional replacement set/clear, and restores the primary cell.

## Release Notes Handling

No version, changelog, or `index.html` release notes are changed by this
handoff document.

When this work is prepared as an actual release task, write release notes in
Ukrainian and mention only behavior that is already implemented and verified.
