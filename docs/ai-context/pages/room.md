# Page: Room

## Route / Location

- Route: `/room`
- Static file: `room.html`
- Backend route: `routes/room.js`

## Purpose

Room is the room/line operational page.

## Primary Entities

- Room
- Line
- Booking
- Room channel/history

## Visible UI

- Status: exact inner controls are unclear from this pass beyond static route and `routes/room.js`.

## Available User Actions

- View/manage room-related data where exposed.

## Data Sources

- `routes/room.js`
- `routes/lines.js`
- `routes/chat.js` room-channel endpoints

## Related Files

- `room.html`
- `routes/room.js`

## Assistant Context

On Room, interpret questions around room/line availability and related bookings. Mark unclear if the user asks about a control not visible in context.
