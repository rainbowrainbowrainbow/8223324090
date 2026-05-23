# Page: Timeline

## Route / Location

- Route: `/`
- Static file: `index.html`
- Backend route: root shell in `server.js`
- Related navigation item: Today group -> `Таймлайн`
- Related mode: `/maysternya-doli` uses the same root shell with a business context.

## Purpose

The Timeline is the main booking calendar/scheduler for daily events, rooms/lines, booking panels, and event operations.

## Primary Entities

- Booking
- Customer/Client
- Lead
- Program/Product
- Room/line
- Task
- Certificate

## Visible UI

- Authenticated CRM shell.
- Timeline/day calendar.
- Booking create/edit panel.
- Lines/rooms and event cards.
- Date controls, filters, status indicators, and action panels.

## Available User Actions

- Create or edit bookings.
- Select date/time/line/room.
- Link bookings to customers and leads.
- Confirm/cancel/update booking state.
- Navigate from related pages into exact booking context.

## Data Sources

- `routes/bookings.js`
- `routes/booking-templates.js`
- `routes/lines.js`
- `routes/customers.js`
- `routes/leads.js`
- `services/booking.js`
- `services/bookingVisibility.js`
- `services/timelineContext.js`

## Related Files

- `index.html`
- `server.js`
- `routes/bookings.js`
- `routes/lines.js`
- `services/bookingVisibility.js`
- `services/timelineContext.js`

## Assistant Context

On Timeline, interpret questions around current date, current booking, booking readiness, room/line placement, customer/lead links, and next operational action.
