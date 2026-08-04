# Checkbox Park Pilot Contract

Status: planning contract, no production code changes.

Last reviewed: 2026-08-04.

## Base

- Production URL checked: `https://8223324090-production.up.railway.app/api/version`.
- Live version: `0.80.82`.
- Live release label: `Мій день: зрозумілі напрями та стартовий набір`.
- Confirmed deploy source branch: `codex/my-day-life-system`.
- Base commit: `3a321dede0445ad7768ad5a27b4d720618241ed8`.
- Pilot branch: `codex/checkbox-park-pilot`.
- Local worktree used for this contract: `.codex-temp/checkbox-park-pilot`.

The previous planning reference to `0.80.55` is stale for implementation base selection. All implementation tasks for this pilot must start from the latest verified production deploy source or a newer verified production source.

## Official Checkbox Sources

- Integration setup page: `https://checkbox.ua/api-integration/`.
- Swagger UI: `https://api.checkbox.in.ua/api/docs`.
- ReDoc UI: `https://api.checkbox.in.ua/api/redoc`.
- OpenAPI JSON discovered from Swagger UI: `https://api.checkbox.in.ua/api/openapi.json`.
- OpenAPI version reviewed: `2.103.0+4bf7154a`.

The Checkbox integration setup flow requires registration in Checkbox, then adding an outlet, cash register, and cashier. Checkbox supports API documentation through Swagger/ReDoc and exposes the current OpenAPI contract from `/api/openapi.json`.

Relevant API capabilities confirmed in OpenAPI:

- Cashier sign-in: `POST /api/v1/cashier/signin`.
- Cashier PIN sign-in: `POST /api/v1/cashier/signinPinCode`.
- Current cashier shift: `GET /api/v1/cashier/shift`.
- Shifts: `GET /api/v1/shifts`, `POST /api/v1/shifts`, `POST /api/v1/shifts/{shift_id}/close`.
- Registers and organization metadata: `GET /api/v1/cash-registers`, `GET /api/v1/organization`.
- Taxes: `GET /api/v1/tax`, `GET /api/v1/cashier/tax`.
- Receipt validation and sale: `POST /api/v1/receipts/validate`, `POST /api/v1/receipts/sell`.
- Receipt status and artifacts: `GET /api/v1/receipts/{receipt_id}`, plus `pdf`, `png`, `qrcode`, `html`, `text`, and `xml` artifact routes.
- Service in/out receipts: `POST /api/v1/receipts/service`.
- Webhook configuration: `GET /api/v1/webhook`, `POST /api/v1/webhook`, `DELETE /api/v1/webhook`.

## MVP Boundary

The pilot is only for the park and only for the middle cash desk.

- Pilot CRM profile: `event_genix`, the existing park profile in `services/businessContext.js`.
- Pilot register alias: `middle`.
- Real Checkbox register ID/license/key is never hardcoded in code, migrations, fixtures, docs, tests, or UI text.
- The real register is resolved through a server-side mapping: `crm_profile_key + register_alias -> Checkbox fiscal profile/register credentials`.
- Different CRM profiles map to separate fiscal profiles, separate FOPs, separate Checkbox organizations/registers/cashiers where required by accounting.
- The preschool/day-care center is out of scope for this pilot. It must become a separate CRM profile and separate fiscal profile before activation.
- Cashiers must not be able to change the fiscal profile after a payment order is created.
- Cashiers must not be able to manually edit tax codes, VAT rates, fiscal profile, register ID, or receipt type at checkout.
- Production feature flag starts disabled. Enabling it for production is a separate protected operation.

The MVP does not include split payments, partial payments, prepayments, subscriptions, deposits, online acquiring automation, offline fiscalization, automatic returns, preschool profile activation, or production auto-close of shifts.

## Ownership Rules

Checkbox remains the official PRRO/fiscal source of truth. EventGenix is the operational cashier UI and local ledger.

- One Checkbox register has one integration owner.
- Do not use Checkbox.Kasa and direct EventGenix API integration on the same register/shift at the same time.
- EventGenix may store Checkbox receipt IDs, fiscal codes, statuses, URLs, QR/PDF references, and webhook payload audit data.
- EventGenix must not generate or label its own receipt as a fiscal receipt.
- Internal `RCP-*` receipts are internal EventGenix receipts only, not DPS fiscal receipts.

## Payment Model

The pilot supports one complete payment for one order.

Allowed payment methods:

- Cash: cashier confirms that cash was received and confirms received amount/change before creating the payment order.
- Card terminal: cashier confirms that the physical terminal showed a successful payment before creating the payment order.

Manual confirmation is mandatory for both cash and card in the pilot. Bank/POS terminal automation is not assumed.

`payment_status` and `fiscal_status` are independent. A payment can be accepted while fiscalization is still pending or failed, and a fiscal error must not erase the payment ledger.

## Profile And Register Mapping

Logical mapping target:

| CRM profile | Business meaning | Pilot register alias | Fiscal profile/FOP | Real Checkbox register |
| --- | --- | --- | --- | --- |
| `event_genix` | Park | `middle` | Park FOP, unresolved exact legal data | Server-side secret/config mapping |
| preschool profile | Preschool/day-care center | not active | Separate preschool FOP/fiscal profile | not active |

Mapping constraints:

- `event_genix + middle` is the only active pilot mapping.
- Missing mapping blocks checkout before payment confirmation.
- Wrong or inactive mapping blocks checkout before payment confirmation.
- A payment order stores immutable snapshots of CRM profile, fiscal profile, register alias, source order, items, prices, tax mapping, cashier, and confirmation data.
- After payment order creation, fiscal profile/register alias is immutable.

## Payment State Machine

Payment order states:

| State | Meaning | Allowed next states |
| --- | --- | --- |
| `draft` | Server built order preview, no money confirmed | `confirmed`, `cancelled` |
| `confirmed` | Cashier confirmed cash/card terminal success | `payment_recorded`, `cancelled_before_fiscalization` |
| `payment_recorded` | Local payment ledger committed | `fiscal_pending`, `refund_pending` |
| `cancelled` | Draft abandoned before money confirmation | terminal |
| `cancelled_before_fiscalization` | Confirmed by mistake before local ledger commit | terminal |
| `refund_pending` | Operator requested refund workflow | `refunded`, `refund_failed`, `refund_cancelled` |
| `refunded` | Local refund ledger completed | terminal |
| `refund_failed` | Money refund failed or is unknown | manual review |
| `refund_cancelled` | Refund request cancelled before money movement | terminal |

The system must not jump from `draft` directly to fiscalization. Local payment ledger must be durable before the fiscal outbox job runs.

## Fiscal State Machine

Fiscal operation states:

| State | Meaning | Allowed next states |
| --- | --- | --- |
| `not_required` | Payment/order type does not require Checkbox | terminal |
| `pending` | Fiscal job created but not sent | `validating`, `blocked`, `failed` |
| `validating` | Payload sent to Checkbox `/receipts/validate` | `ready_to_send`, `validation_failed`, `unknown` |
| `ready_to_send` | Checkbox payload accepted for sale attempt | `sending` |
| `sending` | Sale request sent to Checkbox `/receipts/sell` | `fiscalized`, `failed`, `unknown` |
| `fiscalized` | Checkbox receipt exists and fiscal status is successful/complete | terminal for sale |
| `validation_failed` | Checkbox rejected the payload before sale | manual correction |
| `failed` | Provider returned a known failure | retry or manual review, depending on error class |
| `unknown` | Timeout/network/provider ambiguity | provider status lookup required |
| `blocked` | Missing shift, missing mapping, disabled feature, or unresolved config | manual correction |

If a request times out or the result is ambiguous, EventGenix must query Checkbox receipt status by the durable receipt/payment identifier before retrying. Retrying must be idempotent from the EventGenix side.

## Shift State Machine

Shift states for the pilot:

| State | Meaning | Allowed next states |
| --- | --- | --- |
| `unknown` | Local system has no confirmed Checkbox shift state | `opening`, `open`, `blocked` |
| `opening` | Shift open request is in progress | `open`, `failed`, `unknown` |
| `open` | Checkbox shift is open for the mapped register | `closing`, `closed`, `unknown` |
| `closing` | Close request is in progress | `closed`, `failed`, `unknown` |
| `closed` | Checkbox shift is closed | `opening` |
| `failed` | Known provider failure | retry/manual review |
| `blocked` | Register/profile mapping or credentials are missing | manual correction |

Auto-open may be allowed only after the checkout confirmation clearly tells the cashier which profile, FOP, register alias, and amount will be used. Production auto-close is out of scope until reconciliation is proven.

## Refund State Machine

Refund states:

| State | Meaning | Allowed next states |
| --- | --- | --- |
| `requested` | Refund initiated by operator | `approved`, `cancelled` |
| `approved` | Supervisor/admin approval captured | `money_refund_pending` |
| `money_refund_pending` | Cash/card refund is being handled | `money_refunded`, `money_refund_failed`, `money_refund_unknown` |
| `money_refunded` | Local money refund recorded | `fiscal_return_pending` |
| `fiscal_return_pending` | Fiscal return job created | `fiscal_returned`, `fiscal_return_failed`, `fiscal_return_unknown` |
| `fiscal_returned` | Checkbox return fiscalized | terminal |
| `money_refund_failed` | Refund money movement failed | manual review |
| `money_refund_unknown` | Refund money result unknown | manual reconciliation |
| `fiscal_return_failed` | Checkbox fiscal return failed | manual review |
| `fiscal_return_unknown` | Checkbox return result ambiguous | provider status lookup |
| `cancelled` | Refund stopped before money movement | terminal |

Pilot rule: only full refunds are allowed. Partial refunds and mixed refund methods are out of scope.

## Confirmation Requirements

Every money or irreversible action requires an explicit UI confirmation.

- Sale confirmation shows CRM profile, FOP/fiscal profile label, register alias, items, amount, payment method, cashier, and whether auto-open shift will be attempted.
- Cash confirmation requires received amount and change preview.
- Card confirmation requires an explicit checkbox that the physical terminal showed success.
- Service in/out requires amount, reason, register alias, and privileged confirmation.
- Refund requires original payment, original fiscal receipt, amount, method, reason, and supervisor/admin re-auth.
- Shift close requires unresolved fiscal jobs = zero, unknown provider states = zero, reconciliation checked, and cashier confirmation.

PIN/test secrets must not be hardcoded or documented in repository files. Any test PIN stays only in local secret storage or task-specific environment.

## Open Accounting Decisions

The following are intentionally unresolved and must be provided by the accountant/operator before implementation activates production fiscalization:

- Legal FOP details for the park fiscal profile.
- Legal FOP details for the preschool/day-care fiscal profile.
- Exact Checkbox organization/register/cashier setup for the park middle register.
- Accountant-approved fiscal item names for park ticket/admission products.
- Accountant-approved fiscal item names for birthday/events, merchandise, certificates, food, services, and other sale types.
- Tax group/tax code mapping for each item category.
- VAT status and VAT rate per FOP/category.
- Whether any park goods require excise, special tax group, or unit/UKTZED-style metadata.
- Refund policy and fiscal return wording for full refunds.
- Whether service in/out is allowed operationally and who may approve it.
- Shift close/reconciliation responsibility and accepted difference thresholds.

Until these are resolved, production feature flag must remain disabled.

## Implementation Guardrails For Later Tasks

- Do not fiscalize existing `finance_transactions` directly; they can represent forecasts/plans, not confirmed money.
- Use admission/order snapshots as the first safe source for park ticket checkout.
- Store all money in integer minor units.
- Store immutable snapshots for fiscal payloads and provider responses.
- Use durable outbox jobs for provider calls.
- Webhooks must be authenticated, deduplicated, and audited before affecting fiscal state.
- Provider QR/PDF/link may be shown only after Checkbox confirms fiscalization.
- Internal `RCP-*` may be shown only as an internal receipt.
- Production enablement, secrets, real register IDs, webhook configuration, and first real receipt require separate explicit approval.
