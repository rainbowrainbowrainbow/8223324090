# Page: HR

## Route / Location

- Route: `/hr`
- Static file: `hr.html`
- Page controller: `js/hr-page.js`
- Backend routes: `routes/hr.js`, `routes/users.js`, `routes/staff.js`, `routes/payroll.js`
- Related navigation items: Team group -> `Кадри`, `Команда HR`

## Purpose

HR is the people operations center: who is working, schedule/account surfaces, team structure, reserve, blacklist, reports, AI team, vacations, payroll, rating, onboarding, and account management.

## Primary Entities

- Staff member
- User account
- Shift
- Department
- Payroll scheme
- Vacation/onboarding/blacklist record

## Visible UI

- HR tab bar including `Акаунти`.
- Account Center with search, active/system filters, refresh/reset controls, create account, profile/access/password actions.
- Staff/team/schedule/payroll/onboarding tabs.

## Available User Actions

- View HR staff/schedule/team state.
- Create and manage accounts if creator/director.
- Edit account profile, access, password, active state.
- Link accounts to staff profiles.
- View reports/payroll-related data.

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
