# Page: Profile

## Route / Location

- Route: `/profile`
- Static file: `profile.html`
- Page controller: `js/profile-page.js`
- Backend routes: `routes/auth.js`, `routes/gamification.js`
- Related navigation: user profile entry, feature registry profile link.

## Purpose

Profile is the personal cabinet for avatar, personal state, gamification profile, password/security controls, sessions, and account audit.

## Primary Entities

- User account
- Profile
- Security audit event
- Session
- Achievement/coins

## Visible UI

- Profile/account panels.
- Avatar upload.
- Personal security panel.
- Password change and session revoke controls.
- Gamification/achievement data.

## Available User Actions

- Edit profile/avatar.
- Change password.
- Revoke sessions.
- View security journal.
- View personal gamification state.
- View assigned professions, the selected profession’s checklist template, and current HR admission status.
- View own monthly salary and work results in separate tabs.

## Data Sources

- `routes/auth.js`
- `routes/gamification.js`
- `services/accountSecurity.js`
- `services/profileEmployee.js`: verified account-to-staff link in the Park business context.
- `services/profileEmployeeMonths.js`: employee-only monthly reads. Salary uses saved payroll reports for historical or locked months and the canonical payroll preview for the open current month. Actual payments use the settlement model. Historical breakdowns and payment facts are shown only when recorded.
- `db/migrations/129_profile_improvements.sql`
- `db/migrations/204_account_security_personal_cabinet.sql`

## Related Files

- `profile.html`
- `js/profile-page.js`
- `routes/auth.js`

## Assistant Context

On Profile, account/security questions should point to the personal cabinet, not HR Account Center, unless the user asks about managing other users.

The monthly endpoints are `GET /api/auth/profile/me/salary?month=YYYY-MM` and
`GET /api/auth/profile/me/results?month=YYYY-MM`. They derive staff identity
from the authenticated account and do not accept a staff or user selector.
Results count explicitly linked tasks in the active business, recorded
attendance, checklist completions, training completions, and dated HR
ratings. Current admissions have no monthly history.

For local verification, run `node --test tests/profile-employee-months.test.js`
and `node scripts/run-isolated-postgres-tests.js profile-employee` with a
disposable PostgreSQL target. Run the browser scenario with Playwright
available using `node tests/browser/profile-employee-cabinet-browser-smoke.js`.
