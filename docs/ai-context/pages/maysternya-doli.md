# Page: Maysternya Doli

## Route / Location

- Route: `/maysternya-doli`
- Static file: `index.html`
- Business context: Maysternya Doli consultation timeline mode
- Related navigation item: Today group -> `Майстерня долі`

## Purpose

Maysternya Doli is a business-specific booking/timeline mode for consultation slots rather than standard park event packages.

## Primary Entities

- Consultation booking
- Business context
- Client
- Timeline slot

## Visible UI

- Timeline shell scoped to Maysternya Doli.
- Booking panel configured for consultation options.
- Consultation positions such as demo/full consultation where configured.

## Available User Actions

- View consultation timeline.
- Create consultation bookings.
- Choose consultation duration/position.

## Data Sources

- `index.html`
- `server.js`
- `services/timelineContext.js`
- Maysternya-specific booking/product config in frontend timeline code.

## Related Files

- `index.html`
- `server.js`
- `js/components/sidebar.js`
- `middleware/auth.js`
- `js/auth.js`

## Assistant Context

On this route, do not assume standard entertainment packages. Interpret booking questions as consultation workflow questions unless the user explicitly switches business context.
