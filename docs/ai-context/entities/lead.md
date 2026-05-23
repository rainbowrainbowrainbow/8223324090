# Entity: Lead

## Meaning

A Lead is a sales funnel opportunity/contact before or during conversion into a customer booking. It is handled by `/sales-funnel` and `routes/leads.js`.

## Fields / Properties

Source evidence: `services/customerCommunicationHub.js`, `routes/leads.js`.

- `id`
- `client_name`
- `phone`
- `pipeline_stage`
- `status`
- `booking_id`
- `event_date`
- `assigned_to`
- `lead_id` may link from customer.

## Related Entities

- Lead may link to Client.
- Lead may link to Booking.
- Lead may create Tasks/follow-ups.
- Lead may be referenced by Copilot interactions.

## Where It Appears

- Sales Funnel page.
- Client communication context.
- Timeline booking linkage.
- Copilot sales workspace.

## Assistant Interpretation

On `/sales-funnel`, treat communication/call questions as lead follow-up unless a linked customer is selected. On `/customers`, lead is related context, not the primary object.
