# Universal service costing: local first slice

The first slice adds a business-scoped, versioned costing template for lessons, sessions, rentals, services, agency orders, and admission days. An execution plan selects the template version effective on its date and stores its inputs, line results, revenue, direct cost, and contribution as an immutable snapshot. It is a planning result; it is not a booking, payment, payroll entry, stock movement, or posted P&L item.

## Calculation contract

- Monetary inputs and results are integer minor UAH units. Hourly rates are prorated by integer minutes. Each percentage line rounds half up once to the minor unit.
- Revenue bases are execution, hour, paid participant, or sold unit. Cost bases are execution, hour, consumer/participant, per-line unit quantity, or percentage. A percentage line explicitly selects discounted revenue or the sum of non-percentage direct cost lines; it never includes another percentage line.
- Percentage discounts apply to gross revenue, followed by an absolute discount. Discounts cannot take plan revenue below zero. An optional nonnegative revenue override is an estimate, not a payment record.
- Contribution is discounted revenue minus direct cost. Margin is contribution divided by discounted revenue and is undefined at zero revenue. Break-even attendance for participant-priced plans assumes paid participants equal consumers and searches 0–1000 participants; a null result means no break-even point was found in that range.
- `participants` counts consumers and `paidParticipants` counts charged places; the latter cannot exceed the former. Per-line unit quantities allow equipment, labor, and contractors to have different counts.

## Acceptance evidence

The focused calculator tests cover a group lesson with two free places, a 3.5-hour rental, an agency order with separate quantities, minor-unit rounding, zero revenue, and a fixed discount across low-attendance break-even values. The disposable PostgreSQL HTTP test covers version selection by date, business scoping, immutable history, idempotency key conflict, and stale-version conflict. A browser test opens the real finance page/scripts against a synthetic in-memory API, previews and saves a group lesson, and captures desktop/tablet layouts. No test touches production data.

## Local second slice: execution evidence

Migration 376 adds append-only manual source identities, evidence revisions, correction reversals, completeness attestations, and course/session/day groups. A source is unique by business, system, and external ID across all executions and groups. When one invoice has multiple economic lines, its external IDs must include stable line identifiers. Retrying an identical active record returns the existing entry; a conflicting record requires a reasoned correction, which records a reversal and replacement without rewriting plan or history.

Evidence is either an estimate or a manual confirmation. The word “confirmed” in this workspace means an operator assertion, not a verified payment, payroll posting, or accounting recognition. A category is complete only after an explicit attestation; an active estimate blocks completion, and new evidence invalidates the prior attestation. Zero is shown as fact only after both categories are attested. Until then, actual contribution, margin, and variance stay null. Revenue refunds/negative adjustments need an explicit semantic. A nonpositive net revenue has no margin percentage.

Group membership explicitly includes or excludes each member's planned revenue and cost, so a course sale can be counted once while its sessions contribute their costs. Each plan can belong to at most one group. Group-level completeness also has to be attested, including when shared actuals are zero. Group evidence uses the same source identity index as plan evidence. Group membership is immutable in this local slice; correcting a mis-grouped plan requires a reviewed follow-on migration/workflow.

The browser workspace supports source registration, manual confirmation, reasoned correction, source history, and completeness attestation for a single plan. Group creation and inspection are API-only for now. The read-only reconciliation preview returns every active source as a blocked candidate and writes nothing to finance/P&L.

## Payroll and P&L boundary

`payroll_reports` are monthly staff aggregates, while `payroll_installments` have approval and single-business allocation fields. Neither table assigns a cost to one costing execution. `payroll_payment_movements` represent payout movements, not necessarily the earning expense. The pure payroll candidate contract therefore requires an approved report/installment, matching business, and explicit execution earning allocation; even a verified candidate is never posted by this slice. No existing payroll amount, report, installment, payment, or closed period is changed.

The reconciliation bridge remains read-only because three accounting rules are unresolved:

1. Which booking, payment, invoice, or subscription event recognizes earned revenue, and on which date?
2. How do refunds and reversals affect recognized revenue and historical periods?
3. Which payroll earning/allocation and shared-cost source is canonical, and how is an existing finance transaction deduplicated?

Until those decisions are agreed and tested against the existing P&L, plan snapshots and manual actual assertions must not be inserted into current P&L totals. Kitchen remains excluded.

## Next bounded slices

1. Add an append-only group-membership correction workflow and group management UI before operational rollout.
2. Resolve canonical booking, cashier/payment, subscription, and payroll identities and recognition policies; then implement read-only source adapters with exact allocation and deduplication tests.
3. After reconciliation tests, add a guarded P&L adapter that consumes only the approved canonical posted sources. Never sum plan snapshots or manual assertions into P&L.
4. Model multi-session course and day-pass operational linkage to the execution/group contract. Kitchen stays excluded.

Booking, payment, payroll, permissions, and production migration/deployment are outside this first local slice and require their own guarded review before modification.
