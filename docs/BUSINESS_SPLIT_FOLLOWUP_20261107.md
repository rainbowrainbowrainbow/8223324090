# Business split follow-up: request scope and UI lifecycle

Baseline: `d8208da1ec7c837bfc61582d2653d67c71339459` (0.83.19).

## Changes

- Schedule manual attendance actions use the existing authenticated, business-scoped
  client. Late responses do not update a different scope. Aggregate writes retain
  the shared client's read-only restriction.
- Dashboard task details and task queue actions use that client and the existing
  scoped URL helper. Fallback navigation preserves the canonical `open` task ID
  and business scope. Latest-only detail requests and context generations prevent
  stale task dialogs, fallback navigation, and post-mutation UI updates.
- Schedule roster/profession reads and range commits reject stale account,
  session, business, or capability snapshots. Access/context invalidation clears
  committed staff, schedule, attendance, payroll presentation, and related caches,
  cancels range reads, closes editors, and disables writes. A 401/403 does not
  restore the old roster. A same-context network/500 failure can retain current
  data. Initial access denial stops before range initialization.
- Canonical capabilities are reapplied during cached schedule initialization and
  shared business/permission lifecycle events. Initialization listeners are not
  rebound. Supported reads reload before writes become available again.
- Staff creation, bulk account creation, and staff import controls also require
  the existing staff-surface availability contract. Unsupported Park staff
  creation remains unavailable; its form cannot submit after a context change.
  Schedule management remains independent of the global staff-write surface.

No server authorization, role definitions, account grants, routes, migrations,
production data, secrets, service settings, or protected booking/timeline contract
changes are included. This does not migrate the global staff-write surface.

## Validation

`tests/business-split-followup-ui.test.js` runs the original page modules with the
real shared API client in JSDOM. Its 19 regressions cover a selected business
different from the account default, manual marks, task details/actions, all/multi
read-only scopes, latest-only replies, switch-away-and-back races, canonical deep
links, permission lifecycle invalidation, 401/403 versus 500, initial denial,
range denial, a business switch during initial range loading, staff creation
availability, and cached capability refresh.

The existing work-queue fixture supplies the newly consumed authenticated-client
dependency. It retains its queue behavior assertions; the new regression suite
owns integration with the actual shared client.

Local Chrome QA uses actual staff HTML/CSS/shell/page code and actual Dashboard
task renderers with synthetic in-memory API responses: 390/1440 widths, light/dark,
manual mark click, grant/revoke without reload, denied roster cleanup, and task
widget click/modal cleanup. These checks do not use an employee session or mutate
production. Mobile emulation is not a physical Android device check.

Production publication requires a fresh bounded release envelope under AGENTS.md.
