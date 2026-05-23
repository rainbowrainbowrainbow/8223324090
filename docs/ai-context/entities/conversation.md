# Entity: Conversation

## Meaning

A Conversation is a live omnichannel thread, primarily in Omni/chat infrastructure. It can be linked exactly to a client by `conversations.customer_id` or suggested by matching phone/name.

## Fields / Properties

Source evidence: `services/customerCommunicationHub.js`, `routes/chat.js`, `routes/omnichannel.js`.

- `id`
- `channel`
- `customer_name`
- `customer_phone`
- `customer_id`
- `status`
- `assigned_to`
- `unread_count`
- `last_message_at`
- `last_inbound_at`
- `last_outbound_at`
- `reply_expected`
- `awaiting_reply_since`
- `reply_owner`
- `reply_sla_at`
- `last_message`

## Related Entities

- Conversation may belong to Client.
- Conversation has many messages.
- Conversation can generate reply expectations, tasks, escalation, and work queue items.

## Where It Appears

- Omni page.
- Client communication hub.
- Chat page for internal team channels.

## Assistant Interpretation

Use exact linked conversation first. Suggested matches are not guaranteed links; tell the user when a conversation is only suggested.
