# Page: Sales Funnel / Leads

## Route / Location

- Canonical route: `/sales-funnel`
- Alias: `/leads`
- Static file: `leads.html`
- Page controller: `js/leads-page.js`
- Backend route: `routes/leads.js`
- Related navigation item: Sales group -> `Ліди`

## Purpose

Sales Funnel is the lead management workspace: pipeline stages, lead detail, next contact, booking linkage, scripts, and conversion flow.

## Primary Entities

- Lead
- Client
- Booking
- Task
- Script
- Communication/callback

## Visible UI

- Lead board/list.
- Filters and pipeline stages.
- Lead detail/edit surfaces.
- Booking and customer linkage controls.
- Scripts and next-step actions.

## Available User Actions

- Create/edit leads.
- Move leads through pipeline.
- Link a lead to booking/customer.
- Set callback/follow-up context.
- Open related customer or timeline booking.

## Data Sources

- `routes/leads.js`
- `routes/sales.js`
- `services/leadBookingLink.js`
- `routes/scripts.js`
- `routes/customers.js`

## Related Files

- `leads.html`
- `js/leads-page.js`
- `routes/leads.js`
- `services/leadBookingLink.js`

## Assistant Context

On Sales Funnel, interpret communication/call questions as lead follow-up unless a linked customer is selected. If the user says "клієнт", check whether the lead is already linked to a customer record.
