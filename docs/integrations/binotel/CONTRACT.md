# Binotel telephony contract

Status: `PARTIAL_CAPABILITY_GAP`  
Base: `d328eebee940dd5985917fa79a172b6e9ab65738` (`codex/eventgenix-production`, fetched 2026-09-20)  
Scope: local read-only CRM implementation only. This document is not authorization to enable credentials, alter a provider account, change a public-webhook guard, or deploy.

## Evidence and capability matrix

| Product surface | Provider method/field | Evidence | Status | Implementation rule |
| --- | --- | --- | --- | --- |
| All/incoming/outgoing history | Statistics and inbound-call information exist | Binotel public API overview, retrieved 2026-09-20 | Capability-level only | Do not construct a request until Binotel supplies the account's REST contract. |
| Staff history | `listOfCallsByInternalNumberForPeriod`, `internalNumber`, Unix `startTime`/`stopTime`, stated 7-day limit | Third-party `denostr/binotel-api` documentation, retrieved 2026-09-20 | Unverified third-party | May be represented as an unavailable capability, not sent to a provider. |
| Number history | `historyByNumber` / `historyByExternalNumber` | Third-party SDK documentation, retrieved 2026-09-20 | Unverified third-party | UI must label the number kind; no inferred company/client semantics. |
| Lost calls | `listOfLostCallsToday` | Third-party SDK documentation | Unverified third-party | Only provider-returned lost status may drive the tab. A missed event is not automatically lost. |
| Current calls | `onlineCalls` | Third-party SDK documentation | Unverified third-party | Poll only after the official live-read contract and account capability are supplied. |
| Recording | `callRecord` with a stated 15-minute URL lifetime | Third-party SDK documentation | Unverified third-party | Obtain one short-lived URL server-side; never persist or expose credentials. |
| Queues/operator status | Product Call Center describes queues and operator states | Binotel public Call Center page, retrieved 2026-09-20 | Product capability only | Mark unsupported until a documented API/WebSocket method is provided. |
| Webhook verification | Existing EventGenix uses `x-webhook-secret` | Local source only | Binotel rule unknown | Retain the existing guard; do not claim provider signature/HMAC support. |
| Credentials/endpoint/request signing/pagination/enums | No public machine-readable API reference was accessible | Binotel's current CRM page says REST/Webhook/WebSocket documentation is obtained via technical support | Unknown | No provider HTTP endpoint, payload, enum, rate limit, timezone, or pagination is invented. |

Public sources: [Binotel API overview](https://www.binotel.ua/files/instructions/How_to_use_API.pdf), [Binotel CRM telephony](https://www.binotel.ua/ua/crm-telephony/cloud-crms), and [Binotel Call Center](https://www.binotel.ua/ua/callcenter). The third-party SDK references above are fixtures/research only, not provider confirmation.

## Current EventGenix facts

- Binotel is an existing `history_only`, inbound-only Omni channel. Its scoped runtime fields are `webhookSecret`, `apiKey`, legacy `apiSecret` mapped to `BINOTEL_KEY`, and `accountName`; no browser response exposes these values.
- `POST /api/omni/webhook/binotel` is public only because it verifies the existing provider-secret header before processing. It currently returns `503 processing_failed` on processing failure. BNT work must not expand this public boundary.
- `services/omni-normalizer.js` currently treats provider fields as guesses and uses `||`, which loses a valid numeric zero. `services/omni-webhook-payload.js` does not capture raw bytes for Binotel, but its JSON parser preserves unsafe integer tokens as strings. Neither fact proves Binotel's payload format.
- `processInboundMessage` deduplicates messages through `externalMessageId`; therefore a call lifecycle needs its own idempotent projection rather than appending each state as a new historical event.
- Existing Omni conversations, provider connections, health tables, attachments and all runtime configuration are business-context scoped. New reads, cache keys, recordings and DTO identities must contain `businessContext` and the resolved account identity; there is no default-account fallback.
- Existing authenticated Omni reads use `auth` plus `requestBusinessContext`; the access level for `/omni` is already determined by the established page capability. This package must reuse it and must not change roles, permissions, or customer-history policy.

## Canonical DTO

All provider-facing code returns this shape. A missing value is `null`; a known zero is `0`; provider IDs are strings.

```js
{
  provider: 'binotel',
  businessContext: 'event_genix',
  accountId: null,
  callId: '...',
  direction: 'incoming' | 'outgoing' | 'unknown',
  status: 'ringing' | 'answered' | 'missed' | 'completed' | 'unknown',
  customerPhone: null,
  companyPhone: null,
  agent: { internalNumber: null, name: null, group: null },
  startedAt: null,
  answeredAt: null,
  endedAt: null,
  waitingSeconds: null,
  talkSeconds: null,
  recording: { available: false, callRecordId: null },
  customer: { id: null, name: null },
  source: 'provider_history' | 'webhook',
  capability: 'confirmed' | 'unverified' | 'unsupported'
}
```

`direction`, `status`, timestamps, duration units, record identifier and all provider field mappings remain `unknown` until account-specific official documentation/fixtures are supplied. The DTO deliberately does not carry raw payloads, credentials, recording URLs, or an implicit provider default.

## CRM read API contract

These are proposed authenticated CRM routes, not implemented provider endpoints:

- `GET /api/omni/telephony/calls`: `view` (`all|incoming|outgoing|missed|agent|number`), date range, `agent`, `companyNumber`, `customerNumber`, `status`, cursor/limit. Returns a typed capability/error result rather than an ambiguous empty list.
- `GET /api/omni/telephony/summary`: same date/filter scope; summary values use `null` when provider data is unavailable, never `0` as a fallback.
- `GET /api/omni/telephony/calls/:callId/recording`: server-side short-lived recording resolution only after the existing business/access checks. Its exact grant/redirect pattern must reuse `omni-attachments` and be designed in BNT-06.
- `GET /api/omni/telephony/live`: current calls only; returns `unsupported_capability` until official API support is confirmed.
- `GET /api/omni/telephony/queues`: returns `unsupported_capability` unless queue/operator-state API is documented for this account.

All new routes are authenticated and take the existing explicit business context. Telephony filter state is namespaced (`telephony*`) and must not overwrite Inbox query/hash state such as `channel`, `status`, `view`, `conversation`, `panel=accounts`, or `#accounts`.

## Product semantics

- **Missed**: only an explicit provider lost/missed result. It does not mean an unanswered event has no later callback.
- **By number**: the UI has separate `companyNumber` and `customerNumber` filters. Until a provider mapping is confirmed neither is silently substituted for the other.
- **By employee**: uses a provider internal-number/agent identifier; CRM employee matching is optional enrichment and never authorization.
- **Date boundaries**: UI input is `Europe/Kyiv`; server normalizes the requested closed local dates to UTC instants before any provider query. Exact provider timestamp interpretation remains unknown.
- **Summary**: aggregates only calls returned for the same scoped, normalized query and includes an explicit partial/unavailable indicator.

## Persistence and security decision

Use provider-backed historical reads with a bounded, per-business/per-account operation cache only after an official read contract exists. Do not add a database table or migration for speculative history. Webhook lifecycle updates may update the existing Binotel history projection, but require a dedicated idempotent design and tests; they must not change the webhook authentication boundary.

Logs and DTOs use a field allowlist. They do not log or store raw provider payloads, secrets, phone numbers, recording URLs, or provider response bodies. Trusted provider origin, TLS, timeout, response-size limit, retry policy and pagination can only be coded after the endpoint/signing specification is received.

## Ownership and task allowance

| Task | Allowed local files/area | Dependency condition |
| --- | --- | --- |
| BNT-02 | `services/binotel-client.js`, `services/binotel-call-mapper.js`, focused fixtures/tests | Can build only fail-closed capability handling and DTO mapping; provider transport remains blocked. |
| BNT-03 | Binotel normalizer/lifecycle projection and focused tests | No schema or public-webhook guard modification. Provider enum mapping remains unknown. |
| BNT-04 | authenticated telephony routes/services/tests | Must return typed capability gaps rather than fictional data. |
| BNT-05 | `omni.html`, canonical Omni CSS, focused UI tests | Can render all explicit loading/empty/error/unconfigured/unsupported states. |
| BNT-06 | authenticated recording navigation pattern and client linking | Requires exact recording method/URL contract for real playback; safe unavailable UI may proceed. |
| BNT-07 | live UI and provider capability boundary | Queue data remains unavailable without official API. |
| BNT-08 | tests, screenshots without PII, handoff docs | Candidate is local-only; no activation/deploy. |

Required exact approvals are unchanged: migrations/schema, roles/access/auth changes, production secrets/settings or webhook-provider configuration, provider account activation, commit/push/PR/deploy, and any live request using credentials.
