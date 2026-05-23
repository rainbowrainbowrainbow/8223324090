# Workflow: Lead to Booking Flow

## Purpose

Explain the high-level path from a sales lead to a booking/customer context.

## Source Evidence

- Sales page: `leads.html`, `js/leads-page.js`
- API: `routes/leads.js`, `routes/sales.js`
- Link service: `services/leadBookingLink.js`
- Client context: `routes/customers.js`, `services/customerCommunicationHub.js`
- Timeline booking API: `routes/bookings.js`

## Flow

1. Lead is managed in `/sales-funnel`.
2. Lead can have pipeline/status/assigned user/event date.
3. Lead may link to a booking (`booking_id`) and/or customer (`customers.lead_id` or booking/customer link).
4. Booking appears on Timeline and may link to customer.
5. Client page can show related lead and booking links through communication context.

## Assistant Behavior

- On Sales Funnel, prioritize lead stage and next contact.
- On Client page, lead is related context.
- On Timeline, booking is primary and lead is supporting context.

## Unclear Areas

Status: exact UI controls for every lead-to-booking transition need deeper component inventory if assistants must click users through step-by-step.
