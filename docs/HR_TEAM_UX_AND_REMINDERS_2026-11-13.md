# HR team UX and reminder readiness

## Scope and delivery state

Worktree: `output/hr-team-ux-20261113`, branch `codex/hr-team-ux-20261113`.
Base: `72084b01` from `origin/codex/eventgenix-production`.
Implementation is local and uncommitted. No push, migration, deployment, real
employee update, password reset, resource issue, or payroll operation was run.

The owner explicitly requested the page restrictions and schedule entry point.
The implementation keeps creator, director, vice director, senior manager,
manager, admin, and animator roles eligible for timeline and certificate pages.
Other roles cannot restore those pages through legacy explicit page grants.
Extra eligible roles still count; explicit denies still win. Waiters receive
schedule read access, without schedule management or other HR permissions.
The canonical permission registry drives server/client/sidebar decisions.
Certificate HTTP requests also check the corresponding canonical page capability.

The account-onboarding profession mapper previously mapped
`trampoline_instructor` to `animator`. New onboarding now maps it to `instructor`.
Existing account/membership roles are not rewritten. Before release acceptance,
review legacy staff accounts whose stored access role is animator while their
actual assigned work is not animation. A genuine secondary animator role should
retain access; profession names alone are insufficient grounds to revoke it.

## Interface changes

- New staff and account setup forms select department and position from existing
  scoped staff values and the profession catalog. Existing legacy positions remain
  selectable when editing a staff card.
- New staff primary/secondary profession selectors use native dropdowns. Secondary
  professions are added one at a time, shown as removable chips, deduplicated, and
  removed from the secondary set if selected as primary.
- Document upload, medical book save, and resource issue actions follow their
  fields; mobile actions span the panel width. The resource action is labeled
  `Видати під звіт`. Native file selection is styled and remains keyboard accessible.
- Payroll preview tiles and legacy rate rows use theme surfaces. Calculation,
  rate selection, and payout logic are unchanged.
- Account onboarding ignores backdrop clicks. Explicit close and Escape remain
  available. Manual password reset fields support independent visibility toggles;
  reset endpoints and password policy are unchanged.
- Account details and copied onboarding credentials use `Логін` rather than
  `Username`. Stored usernames and identity links are unchanged.

## Production stock action

The owner authorized four test lighters in the Park stock. On 2026-11-13 the
existing authenticated Chrome session was used to create one stock position:

- Name: `Запальнички — тест HR`
- SKU: `QA-HR-LIGHTERS-20261113`
- Business/owner: Park / `Парк Закревського`
- Category: consumable; quantity: 4; unit: pieces
- Physical storage location: unassigned (the owner specified the business only)
- Notes explicitly mark it as test stock for waiter resource-issue testing.

The UI confirmed creation and displayed a balance of four. No employee received
an assignment. No purchase or payment was created. This is owner-requested stock
retained for their test, not an automated expiring QA run. No automatic cleanup
is scheduled. Identify this exact SKU before any separately authorized cleanup.

## Reminder readiness: code evidence

### Resources issued to employees

`services/hrStaffResources.js` stores issuance, quantity, source, return deadline,
status, and audit information. Warehouse issuance locks stock and checks quantity;
resource return/status changes are handled transactionally.

`js/hr-page.js` renders the due date in the employee card under Documents and
Resources. `staffDateTone` adds warning styling within 30 days and danger styling
after expiry. The current function compares JavaScript dates to `Date.now()`;
calendar-day behavior near midnight deserves a separate Kyiv-date test.
Offboarding readiness also exposes outstanding issued resources.

There is no resource-return reminder producer connected to scheduler, notification
delivery, or My Day. A stored return date does not create a personal task, bell
notification, push, or direct Telegram message. Ordinary employees cannot rely on
the HR manager's resource panel as their own reminder inbox.

### Medical books

`services/hrStaffMedicalBook.js` stores medical books in `staff_certifications`
with category `medical_book`. The HR card computes active/expired status from dates.

`services/scheduler.js:checkCertExpiryReminders` runs at 09:15 Kyiv time. It selects
active staff certifications expiring within 14 days and sends one summary to the
configured Telegram chat, including staff names and certificate names. It is not
an individual employee notification and is not a My Day entry. Runtime Telegram
configuration and actual delivery were not verified in this task.

Readiness gaps found in that existing job:

- The daily sent marker is stored before configuration lookup and successful send,
  so a failure can suppress a same-day retry.
- Expired-status updates occur after an early return when no upcoming rows exist.
- Recipient selection is a configured shared chat; business-specific recipients
  and employee privacy need an explicit design before personal reminders ship.
- SQL uses `CURRENT_DATE` while the scheduler clock uses Kyiv dates.

These are findings, not fixes in this patch. No live notification was sent.

### Recommended reminder implementation

1. On resource issuance, offer an explicit return date and reminder policy.
2. Resolve the assigned employee's linked CRM account within the same business.
3. Put actionable reminders in My Day and the notification inbox; use direct
   Telegram only when a verified recipient link and allowed notification channel exist.
4. Use an idempotency key per assignment, due date and reminder stage. Recheck
   `status = issued` at delivery, cancel obsolete reminders after return, and use
   retryable delivery state rather than an early daily sent flag.
5. Give HR a clear fallback for employees without linked accounts and overdue
   escalation, with business-scoped recipient selection.
6. Validate due-date edits, partial/complete returns, revoked accounts, timezone
   boundaries, retries, and cross-business isolation using synthetic records.

## Identity terminology plan

Use `Імʼя та прізвище` for the staff/display name and `Логін для входу` for the
immutable account username. Credential handoff should show those two labels
separately, followed by the temporary password and CRM URL. Search should match
both name and login while result rows display them on separate lines. Do not
rename existing usernames or infer account links from matching display names.
Finish unification across login, profile, account administration and onboarding
in a dedicated copy review; this patch updates the HR account surfaces only.

## Verification

Implementation files: `hr.html`, `css/hr-page.css`, `js/hr-page.js`, `js/ui.js`,
`js/auth.js`, `js/api.js`, `config/permissionRegistry.js`, `config/accessSurface.js`,
`routes/certificates.js`, and `services/accountOnboarding.js`. Access-matrix,
account-onboarding, certificate-router and HR browser fixtures were updated for
the requested behavior. The new visual/browser regression suite is
`tests/browser/hr-team-ux-browser-smoke.js` and runs from the existing HR Team
browser entrypoint.

- Canonical runtime: Node 22.23.4 / npm 10.9.9.
- Full `npm test` passed (exit 0), including syntax, access matrix, protected
  timeline surface, migration governance, unit, My Day, CRM automation, UI,
  business-isolation and timeline-marketing checks. Log:
  `output/hr-ux-baseline-verified.log`.
- Unit baseline: 3,986 tests passed with zero failures. On this host,
  `GIT_BASH_PATH` points to `D:/Codex/EventGenix/runtime/git/bin/bash.exe`; the
  Windows default Git Bash path does not exist.
- `tests/browser/hr-team-ux-browser-smoke.js`: native selectors, posted secondary
  profession arrays, duplicate/primary exclusion, removal, password visibility,
  backdrop draft retention, action placement/touch size, and dark payroll surfaces.
  Uses synthetic data and production HTML/CSS/JS at 1366 and 390 px in both themes.
- `tests/browser/hr-team-browser-smoke.js`: existing team/profile/resource/payroll
  and structure regressions; permission-hidden actions remain hidden.
- Screenshot evidence: `output/playwright/hr-team-ux/`; desktop/mobile screenshots
  were visually reviewed. The fixtures are synthetic, not production staff.
- Permission tests cover every registered role, explicit grant rejection, denies,
  inherited animator access, and schedule viewing for waiters.
- Actual Express certificate-router tests verify excluded roles receive 403 before
  any database access, including stored page grants. Legacy Telegram certificate
  tests and the synthetic certificate check/image/export/layout browser suites pass.
- The PostgreSQL certificate regression fixture was aligned with the new role
  policy; only its syntax was checked locally. Database-backed certificate and HR
  integration gates still need the disposable PostgreSQL CI environment.

Local browser tests are not database-backed or live release QA. The standard
local production-QA credentials file is absent. A release still needs authorized
commit/push, exact-SHA CI, manual deployment, and post-release checks.
