# Workflow: Omni Reply Flow

## Purpose

Explain how assistants should reason about customer communication replies in Omni.

## Source Evidence

- Page: `omni.html`
- API/services: `routes/omnichannel.js`, `services/omni-hub.js`, `services/replySla.js`, `services/replyEscalation.js`, `services/replyActionHistory.js`
- Client bridge: `services/customerCommunicationHub.js`

## Flow

1. Conversation enters Omni through provider connection.
2. Conversation may be linked exactly to client by `customer_id`.
3. Outbound reply can mark `reply_expected` / waiting-reply state where supported.
4. SLA and escalation services track reply debt.
5. Work queue/dashboard/task surfaces can surface waiting reply pressure.

## Assistant Behavior

- Distinguish live Omni messages from internal CRM communication log.
- If the user asks about a customer on Client page, use exact conversation first, then suggested conversation/search.
- If provider is inbound-only, do not promise CRM can send from that channel.

## Edge Cases

- Suggested conversations are not exact CRM links.
- Provider binding status may block sending.
- Report bot Telegram is not the same as Omni inbox Telegram.
