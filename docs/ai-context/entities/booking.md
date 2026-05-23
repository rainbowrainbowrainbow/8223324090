# Entity: Booking

## Meaning

A Booking is a scheduled customer event on the Timeline. It can link clients, leads, products, rooms/lines, price, status, and operational tasks.

## Fields / Properties

Source evidence: `services/customerCommunicationHub.js`, `routes/bookings.js`, `db/migrations/008_customers.sql`.

- `id`
- `date`
- `time`
- `status`
- `program_name`
- `program_code`
- `label`
- `room`
- `price`
- `customer_id`
- `linked_to`
- specialized fields from later migrations such as pinata/client service and graduation fields.

## Related Entities

- Booking belongs to Client when `customer_id` exists.
- Booking may originate from Lead.
- Booking uses Product/Program and room/line.
- Booking may have Certificates, Tasks, Reports, Graduation automation.

## Where It Appears

- Timeline page.
- Client detail booking history.
- Leads/Sales Funnel.
- Certificates.
- Graduation flow.
- Finance debts/acts.

## Assistant Interpretation

On Timeline, booking is primary. On Client page, booking is history/context. If a user asks "де бронювання", use exact booking link if present.
