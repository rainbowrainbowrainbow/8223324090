# Checkbox Park Pilot Contract

Status: implementation contract for a disabled production MVP. Production Checkbox activation is out of scope.

Last reviewed: 2026-08-08.

## Confirmed Base

- Production URL checked: `https://8223324090-production.up.railway.app/api/version`.
- Live version: `0.80.87`.
- Live release label: `My Day: впливи, теги й AI-розмітка`.
- Confirmed deploy source branch: `codex/my-day-impacts-only-v08086`.
- Confirmed live commit: `7ea78f8ce3d3175c85538893ec92660b3951c622`.
- Local worktree for this release: `.codex-temp/checkbox-thin-mvp-release`.
- Local release branch: `codex/checkbox-thin-mvp-release`.

All follow-up implementation tasks must start from this confirmed deploy source or from a newer live source confirmed by the release staleness guard.

## Official Checkbox Sources

- Integration setup page: `https://checkbox.ua/api-integration/`.
- ReDoc UI: `https://api.checkbox.in.ua/api/redoc`.
- Swagger UI: `https://api.checkbox.in.ua/api/docs`.
- OpenAPI JSON: `https://api.checkbox.in.ua/api/openapi.json`.
- OpenAPI version reviewed: `2.104.1+7f81a60c`, OpenAPI `3.1.0`.

Relevant capabilities confirmed in the current OpenAPI contract:

- Cashier authentication and readiness: `POST /api/v1/cashier/signin`, `POST /api/v1/cashier/signinPinCode`, `GET /api/v1/cashier/me`, `GET /api/v1/cashier/shift`.
- Shifts: `GET /api/v1/shifts`, `POST /api/v1/shifts`, `POST /api/v1/shifts/close`, `POST /api/v1/shifts/{shift_id}/close`.
- Receipt validation and sale: `POST /api/v1/receipts/validate`, `POST /api/v1/receipts/sell`.
- Receipt lookup and artifacts: `GET /api/v1/receipts/{receipt_id}`, `html`, `pdf`, `png`, `qrcode`, `text`, and `xml` artifact routes.
- Service receipts: `POST /api/v1/receipts/service`.
- Webhook configuration: `GET /api/v1/webhook`, `POST /api/v1/webhook`, `DELETE /api/v1/webhook`.

Webhook signature contract confirmed from OpenAPI: Checkbox callback uses `x-request-signature`, calculated as Base64 HMAC-SHA256 over the exact UTF-8 raw request body with the webhook secret key. EventGenix verifies that format route-locally, but production webhook configuration remains out of scope until a separate activation task.

## Product Boundary

The pilot is a thin Checkbox integration for the park middle register. It is not a full cashier application.

Phase 1 exists to prove one controlled path:

- CRM profile: `event_genix` / park.
- Register alias: `middle`.
- Source: server-priced park admission sale.
- Payment methods: cash and manually confirmed card terminal.
- Fiscal result: one durable Checkbox sale receipt, with official URL/QR/PDF shown only after fiscalization.
- Recovery: polling/status lookup for pending or unknown provider states.

Cashier PRO is Phase 2 and must stay disabled separately. Phase 2 includes service in/out, supervisor approval PIN, reconciliation, shift close checklist, refunds, operational reports, auto-close, and preschool/day-care activation.

## Production Gates

- Checkbox integration is disabled by default.
- Cashier PRO is disabled by a separate gate.
- No production Checkbox call is allowed without a separate activation task.
- No production Checkbox credentials, register IDs, webhook secrets, or provider PIN values may be committed, documented, logged, or stored as raw database values.
- Real provider IDs are resolved through server-side configuration/mapping, not hardcoded code or fixtures.
- A missing, inactive, ambiguous, or wrong mapping blocks checkout before money confirmation.
- Feature flags must fail closed in production-like environments.

Required logical gates for follow-up tasks:

| Gate | Default | Scope |
| --- | --- | --- |
| `CHECKBOX_INTEGRATION_ENABLED` | `false` | Allows runtime provider calls and outbox processing for the thin MVP only |
| `EVENTGENIX_CASHIER_PRO_ENABLED` | `false` | Allows Phase 2 operational cashier workflows |
| Register `feature_enabled` | `false` | Allows a specific fiscal register mapping after global enablement |

## Implemented / Incomplete / Phase 2

| Area | Implemented in the Checkbox release worktree based on `7ea78f8...` | Incomplete before thin MVP activation | Phase 2 / Cashier PRO |
| --- | --- | --- | --- |
| Ledger schema | Additive fiscal/payment tables, BIGINT money, immutable item snapshots, idempotency constraints, explicit fiscal item mapping table | Production pilot mapping data still requires separate activation | Additional operational reporting and reconciliation revisions |
| Payment workflow | Server-side order preview, cash/card manual confirmation, received/change snapshot, one local fiscal operation and outbox job | Real admission source activation and accountant-approved mapping data | Split/partial/prepayment not in scope |
| Checkbox adapter | Runtime provider factory, worker-client DTO bridge, receipt UUID lookup, status/error normalization, sandbox harness | Real Checkbox sandbox/prod credentials are not configured in repository | Broader provider operations after MVP sale path |
| Outbox/recovery | Worker skips claiming when disabled/unconfigured, uses locks/batches/retry/backoff/dead letter, and lookup-before-resale | Production integration gate remains disabled | Manual reconciliation UI and operations |
| UI | `/cashier-payments` thin page and menu exist; creator and art director access exists; Phase 2 UI is gated | Live production QA must stay read-only while integration is disabled | Service in/out, close checklist, refunds, reports |
| Permissions | Narrow capabilities, user/profile/location/register bindings, and `capability_scope` enforcement exist | Production bindings require separate operator configuration | Supervisor PIN approval workflows |
| Webhook | Route-specific raw body and official `x-request-signature` Base64 HMAC verification exist | Production webhook configuration remains disabled and out of scope | Provider webhook activation/configuration |
| Sandbox QA | Sandbox smoke script and local mock HTTP/PostgreSQL integration tests exist | Real sandbox run requires local `CHECKBOX_SANDBOX_*` secrets and `is_test=true` proof before mutation | Extended scenarios after MVP sale succeeds |
| Production activation | Not active | Separate activation task required | Preschool/day-care separate profile/FOP/register |

## MVP Mapping

| CRM profile | Business meaning | Register alias | Fiscal profile/FOP | Real Checkbox register |
| --- | --- | --- | --- | --- |
| `event_genix` | Park | `middle` | Park FOP, exact legal data unresolved | Server-side config mapping only |
| preschool profile | Preschool/day-care center | not active | Separate preschool FOP/fiscal profile required | not active |

Rules:

- One Checkbox register has one EventGenix integration owner.
- Do not use Checkbox.Kasa and direct EventGenix API integration on the same register/shift at the same time.
- Each CRM profile maps to a separate fiscal profile/FOP.
- Cashier cannot change fiscal profile, FOP, tax mapping, or register after payment order creation.
- `RCP-*` is an internal EventGenix receipt only, never an official fiscal receipt.

## Phase 1 Payment Flow

1. Server creates an immutable admission order snapshot for `event_genix + middle`.
2. Server resolves fiscal profile, FOP, register, item names, prices, and tax mapping.
3. Cashier sees immutable items, total, CRM profile/FOP, register alias, and payment method.
4. Cash path requires received amount and change preview.
5. Card terminal path requires explicit confirmation that the physical terminal showed success and may store an optional terminal/report reference.
6. In one database transaction, EventGenix locks the payment order, confirms the local payment, creates exactly one fiscal operation, creates exactly one outbox job, and commits.
7. Checkbox HTTP calls happen only after commit.
8. If Checkbox is unavailable or ambiguous, payment remains paid and fiscal status becomes pending/unknown. The system must lookup the provider status before any retry.

No split payments, partial payments, prepayments, subscriptions, deposits, online acquiring automation, or preschool payments are allowed in Phase 1.

## State Machines

Payment states:

| State | Meaning | Allowed next states |
| --- | --- | --- |
| `draft` | Server built order preview, no money confirmed | `confirmed`, `cancelled` |
| `confirmed` | Cashier confirmed cash/card terminal success | `payment_recorded`, `cancelled_before_fiscalization` |
| `payment_recorded` | Local payment ledger committed | `fiscal_pending` |
| `cancelled` | Draft abandoned before money confirmation | terminal |
| `cancelled_before_fiscalization` | Confirmed by mistake before local ledger commit | terminal |

Fiscal sale states:

| State | Meaning | Allowed next states |
| --- | --- | --- |
| `pending` | Fiscal job exists but was not sent | `validating`, `blocked`, `failed` |
| `validating` | Payload sent to Checkbox validation | `ready_to_send`, `validation_failed`, `unknown` |
| `ready_to_send` | Payload is accepted for sale attempt | `sending` |
| `sending` | Sale request sent to Checkbox | `fiscalized`, `failed`, `unknown` |
| `fiscalized` | Official Checkbox sale receipt exists | terminal for sale |
| `validation_failed` | Checkbox rejected payload before sale | manual correction |
| `failed` | Known provider failure | retry/manual review by error class |
| `unknown` | Timeout/network/provider ambiguity | provider status lookup required |
| `blocked` | Disabled feature, missing config, closed shift, or unresolved mapping | manual correction |

Shift states:

| State | Meaning | Allowed next states |
| --- | --- | --- |
| `unknown` | No confirmed local provider shift state | `opening`, `open`, `blocked` |
| `opening` | Shift open request in progress | `open`, `failed`, `unknown` |
| `open` | Checkbox shift is confirmed open for the register | `closing`, `closed`, `unknown` |
| `closing` | Shift close request in progress | `closed`, `failed`, `unknown` |
| `closed` | Checkbox shift is closed | `opening` |
| `failed` | Known provider failure | retry/manual review |
| `blocked` | Mapping, credentials, or gate missing | manual correction |

Refund/service/reconciliation state machines are Phase 2 and must stay behind `EVENTGENIX_CASHIER_PRO_ENABLED=false`.

## Open Accounting Decisions

These are unresolved and block production fiscalization:

- Legal FOP details for the park fiscal profile.
- Exact Checkbox organization, register, cashier, license key, and access key setup for the park middle register.
- Accountant-approved fiscal item names for park admission tickets.
- Tax group/tax code mapping for every Phase 1 admission item.
- VAT status and VAT rate per park FOP/category.
- Whether any sale item needs excise, special tax group, unit metadata, or UKTZED-style metadata.
- Full refund policy and fiscal return wording for Phase 2.
- Whether service in/out is operationally allowed and who may approve it for Phase 2.
- Preschool/day-care legal profile, FOP, register, cashier, item names, and taxes for a separate future activation.

Until these are resolved, `CHECKBOX_INTEGRATION_ENABLED` and register-level `feature_enabled` must remain disabled in production.

## Implementation Guardrails

- Do not use `finance_transactions`, `bookings.paid_amount`, legacy `receipts`, or `cash_register_shifts` as the new fiscal source of truth.
- Do not automatically convert historical finance rows into fiscal payments.
- Store all money in integer minor units.
- Store fiscal payloads and provider responses as immutable audit snapshots with sanitized diagnostics.
- Separate internal tariff references from provider tax IDs.
- Use durable provider UUIDs from fiscal operations for idempotency.
- Never create a second Checkbox sale after a timeout before status lookup proves the first sale does not exist.
- Webhooks must authenticate raw body before mutation, dedupe provider event ID plus payload hash, and never rely on `req.user`.
- Hermes/EventBus delivery failures must not change payment or fiscal statuses.
- Production secrets, real IDs, provider webhook configuration, and the first real fiscal receipt require a separate activation task.
