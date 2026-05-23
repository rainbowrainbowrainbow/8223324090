# Page: Omni

## Route / Location

- Route: `/omni`
- Static file: `omni.html`
- Backend route: `routes/omnichannel.js`
- Related navigation item: Sales group -> `Комунікації`

## Purpose

Omni is the omnichannel inbox for customer conversations across providers such as Telegram, SMS, Viber, Instagram/Facebook, and internal reply workflows.

## Primary Entities

- Conversation
- Message
- Provider connection
- Reply expectation
- Client
- Lead
- Task

## Visible UI

- Conversation list.
- Channel/provider status.
- Message thread.
- Reply compose/actions.
- Telegram binding/status surfaces where implemented.

## Available User Actions

- View conversations.
- Search/filter by customer or channel.
- Send replies where provider supports it.
- Mark/clear waiting reply.
- Connect/test provider bindings where available.

## Data Sources

- `routes/omnichannel.js`
- `services/omni-hub.js`
- `services/omni-accounts.js`
- `services/omni-normalizer.js`
- `services/replySla.js`
- `services/replyEscalation.js`

## Related Files

- `omni.html`
- `routes/omnichannel.js`
- `services/omni-hub.js`
- `db/migrations/168_durable_communication_truth_schema.sql`
- `db/migrations/202_omni_telegram_binding_purpose.sql`

## Assistant Context

On Omni, "дзвінок" is less likely a phone call and more likely a conversation/contact event unless the selected channel/provider is phone/Binotel. Ask one clarification if channel is unclear.
