# Entity: Call

## Meaning

A Call is a client-related communication concept. In the current codebase it is not a separate full table with its own status model. It appears through three mechanisms:

1. a phone action link (`tel:`) built by `services/customerCommunicationHub.js`;
2. possible CRM communication log entries where `communication_log.type = 'call'`;
3. related live communication context in Omni conversations.

## Fields / Properties

Source evidence:

- `services/customerCommunicationHub.js` builds `links.call` from `customer.phone`.
- `db/migrations/076_crm_improvements.sql` creates `communication_log`.
- `routes/customers.js` exposes `/api/customers/:id/communications`.
- `js/customers-page.js` maps communication type `call` to a phone icon in the detail timeline.

For a CRM communication log entry:

- `id`
- `customer_id`
- `type` (`call`, `sms`, `telegram`, `email`, `note`, `meeting` are recognized in frontend icon map; source does not enforce this exact enum)
- `direction`
- `summary`
- `created_by`
- `created_at`
- `created_by_name` in list response

For the phone action:

- `customer.phone`
- generated `tel:<phone>` link

## Related Entities

- Call belongs to a Client when represented as a communication log entry.
- Call may be related to a Lead if the client has a linked lead.
- Call may be related to a Booking if the client has a primary booking.
- Call may route user to Omni if live conversation exists.
- Call note may be created as a [Communication](./communication.md) or [Note](./note.md).

## Where It Appears

- `pages/client.md`: communication hub and CRM communication timeline.
- `services/customerCommunicationHub.js`: call link and context links.
- `js/customers-page.js`: `customerHubAction(links.call, 'Подзвонити', 'success')`; communication timeline icon map.
- `routes/customers.js`: communications list/create endpoints.

## Assistant Interpretation

If the user is on the Client page and says "дзвінок":

- If a customer is selected and has phone: offer the `Подзвонити` phone action.
- If the user asks "історія дзвінків": use CRM communication log and mention that live message history is in Omni.
- If the user asks to "створити дзвінок": source evidence supports communication log entries, but the current visible UI button creates notes; ask whether they want to add a CRM note about the call or open the phone/Omni channel.
- Do not claim there is a first-class call status field unless new source evidence is added.

Status: call statuses and dedicated call creation/edit forms are unclear from codebase.
