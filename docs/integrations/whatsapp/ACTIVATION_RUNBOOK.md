# WhatsApp Business Platform activation runbook

Updated 2026-09-12 for OMNI-WA1. Production impact: no for this preparation packet. Production impact becomes yes only in a separately approved activation task that explicitly allows production secrets/settings, Meta subscriptions, the real phone number, and controlled test messages.

This document does not authorize connecting a real number, changing Meta or Railway settings, changing production secrets, subscribing webhooks, or sending WhatsApp messages.

## Current production preflight evidence

Read-only live check against `https://8223324090-production.up.railway.app` on 2026-09-12T11:40:26Z:

| Business context | Status | Connected | Send capable | Receive capable | Preflight | Present categories | Missing categories |
|---|---:|---:|---:|---:|---|---|---|
| `event_genix` | `disconnected` | `false` | `false` | `false` | read-only, redacted, not ready | `callbackUrl` | `wabaId`, `phoneNumberId`, `accessToken`, `appSecret`, `verifyToken` |
| `maysternya_doli` | `disconnected` | `false` | `false` | `false` | read-only, redacted, not ready | `callbackUrl` | `wabaId`, `phoneNumberId`, `accessToken`, `appSecret`, `verifyToken` |

Additional live guardrail: unsigned `POST /api/omni/webhook/whatsapp` returned `401`. This confirms the production webhook does not accept unsigned WhatsApp payloads during the disconnected state.

## Activation goal

Make WhatsApp activation predictable before a real WhatsApp Business number is connected. Operators should see which configuration categories are missing without seeing token, app secret, verify token, WABA ID, or Phone Number ID values in CRM responses, logs, screenshots, or docs.

Until all required categories are present and the owner explicitly approves activation, WhatsApp must stay `disconnected`, `sendCapable=false`, and `receiveCapable=false`.

## Required configuration categories

The Omni account status preflight reports only `present` or `missing` for these categories:

| Category | Purpose | Secret value exposure |
|---|---|---|
| WABA ID | Confirms the expected WhatsApp Business Account in incoming webhook entries. | Never shown as a raw value by preflight. |
| Phone Number ID | Confirms the exact WhatsApp Business Platform number and Graph send endpoint. | Never shown as a raw value by preflight. |
| Access token | Authorizes Graph API calls for the configured number. | Secret; never shown. |
| Meta app secret | Verifies `X-Hub-Signature-256` on webhook POST requests. | Secret; never shown. |
| Webhook verify token | Answers Meta webhook challenge during subscription setup. | Secret; never shown. |
| Callback URL | Public HTTPS CRM URL for `/api/omni/webhook/whatsapp`. | Public setup URL; safe to copy into Meta, but it should still be handled as operational configuration. |

## Operator checklist before activation

The owner/operator must provide or confirm these items before Codex or an engineer changes production configuration:

1. Real WhatsApp Business number selected for CRM Omni.
2. Meta Business App and WhatsApp Business Account confirmed.
3. WABA ID for the selected WhatsApp Business Account.
4. Phone Number ID for the selected production phone number.
5. Production access token with the minimum required WhatsApp Cloud API permissions.
6. Meta app secret for signature validation.
7. Webhook verify token chosen for this CRM environment.
8. Callback URL confirmed as HTTPS and pointing to production `/api/omni/webhook/whatsapp`.
9. Explicit approval to change production secrets/settings.
10. Explicit approval to configure or update Meta webhook subscription.
11. Explicit approval for one inbound test message from an approved test sender.
12. Explicit approval for one outbound test reply, only inside Meta's allowed customer care window.

Do not paste secret values into chat, docs, screenshots, issue comments, PR descriptions, or terminal output. Use the approved secret-management path for the deployment environment.

## What Codex can do after separate activation approval

After the owner gives a separate explicit activation task, Codex can perform these bounded steps without printing secret values:

1. Run read-only production preflight and report only `present`/`missing` categories.
2. Confirm the public callback endpoint rejects unsigned POST requests with `401`.
3. Validate the Meta callback challenge after the verify token is configured.
4. Verify the configured WABA ID and Phone Number ID by sending one approved signed fixture or by observing the approved live inbound test.
5. Confirm that receipts are handled as lifecycle events and not saved as inbound client messages.
6. Run controlled QA for one inbound and, if approved, one outbound test message.
7. Record version, commit SHA, business context, timestamps, channel, and provider message IDs without recording message text or secrets.

Codex must not connect the real number, change Railway env vars, rotate secrets, subscribe Meta webhooks, or send production WhatsApp messages unless those exact actions are included in the separate activation approval.

## Code-level fixture gates before activation

These existing behavior gates must remain true before an operator touches Meta settings:

1. Webhook challenge accepts the configured verify token and returns the challenge string.
2. Wrong verify token returns `403`.
3. Unsigned or wrongly signed webhook POST returns `401` and does not persist inbound messages or receipts.
4. Webhook payload with mismatched WABA ID or Phone Number ID is acknowledged as ignored and does not persist business data.
5. Delivery/read receipts are classified as lifecycle receipts, not inbound messages.
6. Account-status preflight serializes only category status, never raw secret values.

## Controlled activation scenario

Use this sequence only after the owner explicitly approves activation scope for the real WABA:

1. Confirm the Omni preflight has all required categories present for the target business context.
2. In Meta Webhooks, set the callback URL to the CRM WhatsApp callback and use the configured verify token.
3. Subscribe the WhatsApp Business Account to `messages`.
4. Send one inbound test message from an approved test number to the connected WhatsApp number.
5. Confirm the message appears in Omni under the expected business context and channel `whatsapp`.
6. Send one controlled outbound reply only if the conversation is inside the 24-hour customer care window and the owner approved that test message.
7. Confirm delivery/read receipt handling if Meta returns statuses.
8. Capture release SHA, version, business context, channel, timestamps, and provider message IDs. Do not capture message text or secret values.

## Rollback and hold conditions

Hold activation if any required category is missing, the callback URL is not HTTPS, the callback challenge fails, unsigned webhook requests do not return `401`, signed inbound validation fails, WABA ID or Phone Number ID does not match, or the owner has not approved the real number/test messages.

Rollback is configuration-only:

1. Pause or remove the Meta WABA webhook subscription.
2. Mark the CRM WhatsApp connection disconnected or remove the runtime secret categories from production configuration through the approved operator path.
3. Re-run read-only preflight and confirm `disconnected`, `sendCapable=false`, `receiveCapable=false`.
4. Do not delete CRM conversations, lead records, provider message IDs, audit rows, or webhook diagnostics as part of rollback unless a separate data-remediation task explicitly authorizes it.
