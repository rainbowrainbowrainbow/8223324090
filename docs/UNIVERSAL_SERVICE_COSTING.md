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

## Next bounded slices

1. **Execution linkage and actuals.** Add an explicit execution reference and append-only actual cost/revenue adjustments, each with a source ID, business context, timestamp, and correction/reversal link. Keep a plan-to-actual variance view; never rewrite the plan snapshot. Support signed negative revenue adjustments in actuals with a documented margin convention.
2. **Source reconciliation.** Resolve booking, cashier/payment, invoice, payroll, and warehouse source identities before writing adapters. Deduplicate by `(business_context, source_system, source_id, economic_role)` so a booking estimate and a posted payment cannot both count as earned revenue, and a planned staff line cannot count again as payroll actual.
3. **Financial reporting.** After reconciliation tests, expose actual contribution and variance by execution in finance. Feed P&L only from canonical posted sources through the existing reporting policy. Do not sum plan snapshots into P&L.
4. **Operational specializations.** Model multi-session courses, shared shifts/day passes, and kitchen recipes/stock depletion as separate adapters to the same execution/actual contract. Kitchen remains deferred until stock and recipe source rules are agreed.

Booking, payment, payroll, permissions, and production migration/deployment are outside this first local slice and require their own guarded review before modification.
