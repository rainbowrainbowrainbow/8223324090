# Entity: Client / Customer

## Meaning

A Client is a CRM customer record stored in the `customers` table and exposed by `/api/customers`. The codebase uses both "client" and "customer" language; the canonical table/API name is `customers`.

## Fields / Properties

Source evidence: `db/migrations/008_customers.sql`, `routes/customers.js`, `js/customers-page.js`.

- `id`
- `name`
- `phone`
- `instagram`
- `child_name` / `childName`
- `child_birthday` / `childBirthday`
- `source`
- `notes`
- `total_bookings` / `totalBookings`
- `total_spent` / `totalSpent`
- `first_visit` / `firstVisit`
- `last_visit` / `lastVisit`
- `created_at` / `createdAt`
- `updated_at` / `updatedAt`
- `social_identities` / `socialIdentities`
- `lead_id` / `leadId`
- derived fields: tags, bookings, certificates, LTV, RFM scores.

## Related Entities

- Client has many bookings through `bookings.customer_id`.
- Client has many certificates through `certificates.customer_id`.
- Client has many communication log entries through `communication_log.customer_id`.
- Client can be linked to a lead through `customers.lead_id`.
- Client can have exact Omni conversations through `conversations.customer_id`.
- Client may have suggested Omni conversations by phone/name matching.
- Client has many tags through `customer_tags`.

## Where It Appears

- Client page: `docs/ai-context/pages/client.md`.
- Timeline booking form/customer selection.
- Sales funnel lead linkage.
- Certificates detail/issue flows.
- Omni communication context.
- Center client block.

## Assistant Interpretation

When the user says "клієнт" on `/customers`, assume the selected/open customer record. If no selected customer is known, ask which client. If the user says "client" on a lead/booking page, check whether a linked customer exists before answering.
