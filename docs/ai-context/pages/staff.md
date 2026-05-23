# Page: Staff Schedule

## Route / Location

- Route: `/staff`
- Static file: `staff.html`
- Page controller: `js/staff-page.js`
- Backend routes: `routes/staff.js`, `routes/employees.js`, `routes/workers.js`
- Related navigation item: Team group -> `Графік`

## Purpose

Staff is the schedule and staff operations page for shifts, workers, departments, check-ins, attendance, and staff profile links.

## Primary Entities

- Staff member
- Shift
- Schedule row
- Department
- Check-in
- User account

## Visible UI

- Staff schedule/day grid.
- Staff lists and detail/edit modals.
- Schedule controls and attendance/check-in links.

## Available User Actions

- View staff schedule.
- Edit staff and shifts where allowed.
- Connect staff with user accounts.
- Inspect attendance/check-in state.

## Data Sources

- `routes/staff.js`
- `routes/employees.js`
- `routes/workers.js`
- `services/hr.js`

## Related Files

- `staff.html`
- `js/staff-page.js`
- `routes/staff.js`

## Assistant Context

On Staff, interpret "хто зараз", "зміна", "графік", and "аніматор" through staff/schedule context before HR account context.
