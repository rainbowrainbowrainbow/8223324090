# Universal service costing: local first slice

The first slice adds a business-scoped, versioned costing template for lessons, sessions, rentals, services, agency orders, and admission days. An execution plan selects the template version effective on its date and stores its inputs, line results, revenue, direct cost, and contribution as an immutable snapshot. It is a planning result; it is not a booking, payment, payroll entry, stock movement, or posted P&L item.

## Calculation contract

- Monetary inputs and results are integer minor UAH units. Hourly rates are prorated by integer minutes. Each percentage line rounds half up once to the minor unit.
- Revenue bases are execution, hour, paid participant, or sold unit. Cost bases are execution, hour, consumer/participant, per-line unit quantity, or percentage. A percentage line explicitly selects discounted revenue or the sum of non-percentage direct cost lines; it never includes another percentage line.
- Percentage discounts apply to gross revenue, followed by an absolute discount. Discounts cannot take plan revenue below zero. An optional nonnegative revenue override is an estimate, not a payment record.
- Contribution is discounted revenue minus direct cost. Margin is contribution divided by discounted revenue and is undefined at zero revenue. Break-even attendance for participant-priced plans assumes paid participants equal consumers and searches 0–1000 participants; a null result means no break-even point was found in that range.
- `participants` counts consumers and `paidParticipants` counts charged places; the latter cannot exceed the former. Per-line unit quantities allow equipment, labor, and contractors to have different counts.

## Acceptance evidence

The focused calculator tests cover a group lesson with two free places, a 3.5-hour rental, an agency order with separate quantities, minor-unit rounding, zero revenue, and a fixed discount across low-attendance break-even values. The disposable PostgreSQL HTTP tests cover version selection by date, business scoping, immutable history, idempotency and concurrent retries, stale-version conflict, correction/attestation races, group inclusion and rejection of duplicate/cross-business/nested members, and canonical reference amount checks. A browser test opens the real finance page/scripts against a synthetic in-memory API. A second browser test uses the real finance parent route, its role/action middleware, and disposable PostgreSQL for plan → actual → group → canonical-link preview; it also verifies a viewer is denied. Screenshots include desktop and tablet layouts. No test touches production data.

## Local second slice: execution evidence

Migration 376 adds append-only manual source identities, evidence revisions, correction reversals, completeness attestations, and course/session/day groups. A source is unique by business, system, and external ID across all executions and groups. When one invoice has multiple economic lines, its external IDs must include stable line identifiers. Retrying an identical active record returns the existing entry; a conflicting record requires a reasoned correction, which records a reversal and replacement without rewriting plan or history.

Evidence is either an estimate or a manual confirmation. The word “confirmed” in this workspace means an operator assertion, not a verified payment, payroll posting, or accounting recognition. A category is complete only after an explicit attestation; an active estimate blocks completion, and new evidence invalidates the prior attestation. Zero is shown as fact only after both categories are attested. Until then, actual contribution, margin, and variance stay null. Revenue refunds/negative adjustments need an explicit semantic. A nonpositive net revenue has no margin percentage.

Group membership explicitly includes or excludes each member's planned revenue and cost, so a course sale can be counted once while its sessions contribute their costs. A plan can belong to at most one *current* group composition. Group-level completeness also has to be attested, including when shared actuals are zero; its request requires the reviewed `expectedRevision`, so a stale client cannot reinstate an attestation after a composition edit. Group evidence uses the same source identity index as plan evidence. Migration 377 copies preexisting immutable membership into revision 1 without rewriting it. Every correction appends a full new membership snapshot with a reason and expected revision; a stale concurrent edit returns 409. The prior revision stays readable, a removed plan becomes available for another group, and both group completeness attestations are invalidated by appended events.

The browser workspace supports source registration, manual confirmation, reasoned correction, source history, and completeness attestation for a single plan. It also creates, inspects, and revises groups with explicit member revenue/cost flags and visible revision history. Membership is plan-only, so nested group cycles are structurally excluded; the API rejects nested member payloads, repeated plan IDs, cross-business members, and a plan currently used by another group. The read-only reconciliation preview returns every active source as a blocked candidate and writes nothing to finance/P&L.

The canonical source preview reads `bookings`, `education_attendance` plus its booking, `payroll_installments` plus its report, and payment orders/refunds plus their fiscal profile. It requires an exact business match and, for monetary records, an exact amount match. Attendance verifies only ID and business because it has no monetary amount; the UI reports only fields actually checked. Booking/payroll values in legacy tables are integer UAH and converted to minor units only for comparison; payment ledger values are already minor units. Refund preview uses a negative amount. Fiscal `crm_profile_key` must equal the costing business context; no unapproved mapping is guessed. Even a matching reference is only a read-only link preview: source statuses can change, attendance has no money, payroll has no execution allocation, and payment/refund recognition remains unresolved. It never creates a costing actual source or a finance transaction. Manual entries remain marked as manual assertions, including when an operator calls one “payroll” in its economic role; synthetic fixtures are confined to disposable test databases.

Execution detail and group reads use one PostgreSQL repeatable-read, read-only snapshot, so a concurrent correction cannot mix an active source from one moment with history or completion from another.

## Payroll and P&L boundary

`payroll_reports` are monthly staff aggregates, while `payroll_installments` have approval and single-business allocation fields. Neither table assigns a cost to one costing execution. `payroll_payment_movements` represent payout movements, not necessarily the earning expense. The pure payroll candidate contract therefore requires an approved report/installment, matching business, and explicit execution earning allocation; even a verified candidate is never posted by this slice. No existing payroll amount, report, installment, payment, or closed period is changed.

The reconciliation bridge remains read-only because three accounting rules are unresolved:

1. Which booking, payment, invoice, or subscription event recognizes earned revenue, and on which date?
2. How do refunds and reversals affect recognized revenue and historical periods?
3. Which payroll earning/allocation and shared-cost source is canonical, and how is an existing finance transaction deduplicated?

Until those decisions are agreed and tested against the existing P&L, plan snapshots and manual actual assertions must not be inserted into current P&L totals. Kitchen remains excluded.

## Next bounded slices

1. Resolve canonical booking, cashier/payment, subscription, and payroll identities and recognition policies; then implement read-only source adapters with exact allocation and deduplication tests.
2. After reconciliation tests, add a guarded P&L adapter that consumes only the approved canonical posted sources. Never sum plan snapshots or manual assertions into P&L.
3. Model multi-session course and day-pass operational linkage to the execution/group contract. Kitchen stays excluded.

Booking, payment, payroll, permissions, and production migration/deployment are outside this first local slice and require their own guarded review before modification.
