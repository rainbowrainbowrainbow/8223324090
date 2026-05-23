# Entity: Communication

## Meaning

A Communication is an internal CRM log entry or live conversation context around a client. The internal CRM log is stored in `communication_log`; live conversations are handled by Omni/chat-related tables.

## Fields / Properties

Internal CRM log:

- `id`
- `customer_id`
- `type`
- `direction`
- `summary`
- `created_by`
- `created_at`

Communication context payload from `services/customerCommunicationHub.js`:

- `customer`
- `lead`
- `bookings`
- `primaryBooking`
- `crmLog`
- `live`
- `links`
- `summary`
- `sendPolicy`

## Related Entities

- Communication belongs to a Client.
- Communication may refer to a Call, Note, Meeting, SMS, Telegram, Email.
- Communication can point to Omni Conversation.
- Communication can link to Lead and Booking context.

## Where It Appears

- Client detail modal communication hub.
- Client CRM communication timeline.
- Omni page for live conversations.

## Assistant Interpretation

Always distinguish internal CRM communication log from live Omni message history. If the user asks "що писали/дзвонили", answer from current visible context; if only CRM log is available, say live history opens in Omni.
