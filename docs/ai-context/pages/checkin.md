# Page: Check-in

## Route / Location

- Route: `/checkin`
- Static file: `checkin.html`
- Related navigation item: Team group -> `Check-in`

## Purpose

Check-in is the staff attendance/face check-in page using camera and face descriptors.

## Primary Entities

- Staff member
- Face descriptor
- Check-in record

## Visible UI

- Camera view.
- Staff enrollment controls.
- Check-in log.

## Available User Actions

- Start camera/check-in flow.
- Enroll face descriptor for staff.
- View check-in log.

## Data Sources

- `routes/staff.js`
- `db/migrations/049_face_checkin.sql`

## Related Files

- `checkin.html`
- `routes/staff.js`

## Assistant Context

On Check-in, answer around attendance, camera permissions, staff identity, and check-in history. Do not treat this as customer check-in.
