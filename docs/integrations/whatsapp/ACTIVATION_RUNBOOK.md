# WhatsApp Business Platform activation runbook

Updated 2026-09-12. Production impact: yes only during a separately approved activation. This runbook does not authorize connecting a real number, changing Meta subscriptions, changing production secrets, or sending messages.

## Goal

Make WhatsApp activation predictable before a real WABA number is connected. Operators should be able to see which configuration categories are missing without seeing secret values in CRM responses, logs, screenshots, or docs.

## Required configuration categories

The Omni account status preflight reports only `present` or `missing` for these categories:

| Category | Purpose | Secret value exposure |
|---|---|---|
| WABA ID | Confirms the expected WhatsApp Business Account in incoming webhook entries. | Never shown as a raw value by preflight. |
| Phone Number ID | Confirms the exact WhatsApp Business Platform number and Graph send endpoint. | Never shown as a raw value by preflight. |
| Access token | Authorizes Graph API calls for the configured number. | Secret; never shown. |
| Meta app secret | Verifies `X-Hub-Signature-256` on webhook POST requests. | Secret; never shown. |
| Webhook verify token | Answers Meta webhook challenge during subscription setup. | Secret; never shown. |
| Callback URL | Public HTTPS CRM URL for `/api/omni/webhook/whatsapp`. | URL category only; exact URL may be visible in setup UI because Meta requires copying it. |

Until all required categories are present, WhatsApp must stay `disconnected`, `sendCapable=false`, and `receiveCapable=false`.

## Read-only preflight

Open Omni → channel connections → WhatsApp. The preflight checklist should show one chip per category with `present` or `missing`.

The preflight is read-only:

- it does not call Meta;
- it does not subscribe the app to WABA events;
- it does not send a message;
- it does not print token, app secret, verify token, WABA ID, or Phone Number ID values.

If the callback URL is missing, confirm that the deployment exposes a public HTTPS base URL before attempting Meta subscription. A relative callback path is useful for local development, but it is not enough for controlled production activation.

## Fixture gates before activation

Code-level fixtures must pass before an operator touches Meta settings:

1. Webhook challenge accepts the configured verify token and returns the challenge string.
2. Unsigned or wrongly signed webhook POST returns `401` and does not persist inbound messages or receipts.
3. Webhook payload with mismatched WABA ID or Phone Number ID is acknowledged as ignored and does not persist business data.
4. Delivery/read receipts are classified as lifecycle receipts, not inbound messages.
5. Account-status preflight serializes only status categories, never raw secret values.

## Controlled activation scenario

Use this sequence only after the operator explicitly approves activation scope for the real WABA:

1. Confirm the Omni preflight has all required categories present.
2. In Meta Webhooks, set the callback URL to the CRM WhatsApp callback and use the configured verify token.
3. Subscribe the WhatsApp Business Account to `messages`.
4. Send one inbound test message from an approved test number to the connected WhatsApp number.
5. Confirm the message appears in Omni under the expected business context and channel `whatsapp`.
6. Send one controlled outbound reply only if the conversation is inside the 24-hour customer care window and the operator approved that test message.
7. Confirm delivery/read receipt handling if Meta returns statuses.
8. Capture release SHA, version, business context, channel, timestamps, and provider message IDs. Do not capture message text or secret values.

## Rollback and hold conditions

Hold activation if any required category is missing, the callback URL is not HTTPS, the signed inbound fixture fails, the WABA or Phone Number ID does not match, or unsigned webhook requests do not return `401`.

Rollback is configuration-only: remove or pause the Meta WABA webhook subscription and mark the CRM connection disconnected. Do not delete CRM conversations or lead records as part of rollback.
