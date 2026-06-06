# Page: HR

## Route / Location

- Route: `/hr`
- Static file: `hr.html`
- Page controller: `js/hr-page.js`
- Backend routes: `routes/hr.js`, `routes/users.js`, `routes/staff.js`, `routes/payroll.js`
- Related navigation items: Team group -> `Кадри`, `Команда HR`

## Purpose

HR is the people operations center: who is working, schedule/account surfaces, team structure, reserve, blacklist, dismissed staff archive, reports, vacations, payroll, KPI, onboarding, and account management.

## Primary Entities

- Staff member
- User account
- Shift
- Department
- Payroll scheme
- Vacation/onboarding/blacklist record
- Offboarding event / dismissed staff profile

## Visible UI

- HR tab bar including `Акаунти`.
- Account Center with search, active/system filters, refresh/reset controls, create account, profile/access/password actions.
- Staff/team/schedule/payroll/onboarding tabs.
- Team buckets: `Робітники`, `Стажери`, `Резерв`, `Чорний список`, `Звільнені`.

## Available User Actions

- View HR staff/schedule/team state.
- Create and manage accounts if creator/director.
- Edit account profile, access, password, active state.
- Link accounts to staff profiles.
- View reports/payroll-related data.
- Review dismissed staff in `/hr#dismissed`.
- Complete dismissal through the staff profile offboarding block, not by changing `hr_pool_status` directly.
- Return a dismissed profile to an active bucket through Team move/reactivation when the user explicitly wants to bring the person back.

## Data Sources

- `routes/hr.js`
- `routes/users.js`
- `routes/staff.js`
- `routes/payroll.js`
- `services/hr.js`

## Related Files

- `hr.html`
- `js/hr-page.js`
- `routes/users.js`
- `routes/hr.js`

## Assistant Context

On HR, distinguish staff records from login accounts. If the user asks about "акаунт", use the Account Center. If they ask about "аніматор" or "графік", prefer staff/schedule context.

For Kleshnya/assistant routing:

- `Звільнені` is a Team bucket at `/hr#dismissed`.
- The dismissed bucket is derived from `staff.is_active = false`; it is not a separate `hr_pool_status`.
- `hr_pool_status` stays for active operational pools: `core`, `reserve`, `blacklisted`.
- Offboarding source of truth is `POST /api/hr/staff/:id/offboarding`, which writes `staff_offboarding_events`, `termination_date`, `termination_reason`, and marks the staff profile inactive.
- Do not tell users to move an active person directly into `Звільнені`; tell them to open the staff profile and complete the offboarding block so reason, account action, documents, and resources are handled.
- If a dismissed person should return, use the Team move flow from `Звільнені` to `Робітники`, `Стажери`, `Резерв`, or `Чорний список`; the UI reactivates the profile through `/api/hr/staff/:id/status`.
