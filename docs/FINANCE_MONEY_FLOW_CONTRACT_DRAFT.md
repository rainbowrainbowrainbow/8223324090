# Finance money flow: proposed local implementation contract

Date: 2026-10-07. Status: the owner approved the bounded local implementation with “Дозволяю блок FIN-MONEY-01-LOCAL”. The proposed contract below is retained as the approval baseline; implementation evidence and remaining limitations are recorded in [the local implementation report](FINANCE_MONEY_LOCAL_STATUS_2026-10-07.md). This is not production authorization.

Baseline inspected: `ea635cf69`, branch `codex/finance-workflow-wave1`, package `0.82.70`. Source references describe that baseline; concurrent Green UI work may shift line numbers. The earlier requirements and critique are in `optimization-worktree/docs/FINANCE_REVIEW_PLAN_2026-10-07.md` in the sibling checkout. This document narrows its money-flow recommendations into one reviewable next block.

**Production impact: no** for this document and the proposed local-only build. **Production impact: yes** for a later cutover or deployment of the resulting payment/schema changes. No production data, credentials, provider calls, commits, pushes, or deployments were performed for this draft.

## Decision to make

Recommend a small non-fiscal account-movement service for manual accounts, reusing existing money utilities, business scoping, transaction/idempotency patterns and finance permissions. Reuse the existing fiscal payment service as the sole writer for Checkbox payments; do not force manual tills through it. Keep booking-value projections separate from receipts. A manual cash account is an existing `finance_accounts` row with type `cash`, not a new fiscal register.

The next authorized block should implement and test this contract locally with synthetic records. It must not silently migrate the company to a new accounting model or reconstruct old payments from booking values.

## What existing payment code can actually support

| Existing component | Verified behavior | Reuse decision |
| --- | --- | --- |
| `services/payments/money.js` | Decimal UAH strings convert to integer minor units; BIGINT values serialize as strings. | Reuse its pure conversion/validation helpers; no new package. Legacy integer UAH must be converted explicitly, never copied as kopecks. |
| `payment_orders` / `payment_allocations` | Migration `316_payment_fiscal_ledger_foundation.sql:107–154,201–220` requires a fiscal profile/register for orders and a fiscal profile/order for allocations. Tender is cash/card_terminal; one allocation per order is unique. | Not a ready schema for non-fiscal tills, bank transfers or several partial payments against one order. Do not remove its constraints or create fake fiscal profiles. |
| `services/payments/paymentStateMachine.js:47–98` | Confirmation is for the entire immutable order amount; cash can include change, card amount must match exactly. | Do not interpret cash received/change fields as partial payments. Reuse validation principles, not this full-sale contract for deposits. |
| `services/payments/paymentService.js:1298–1488` | Confirmation checks register/item readiness, records an attempt/allocation and then creates/uses a fiscal shift and fiscal operation. Disabling the optional readiness check does not remove this fiscal coupling. | Keep as the sole fiscal-sale writer. Never call it just to add money to a manual till. |
| `routes/payments.js:657,702,928` | Existing creation routes are admission-ticket and catalog-sale orders, then order confirmation. | A general partial-payment adapter for bookings was not established by this audit. Do not infer it from the generic table names. |
| `services/payments/cashierOperationsService.js:2907–2990` | Full refund requires the original sale receipt, fiscal context/open shift and refund capability. It records money-refund status separately from fiscal-return status. | Preserve this workflow. It is not a generic manual partial-refund API. Migration `319:45` constrains `refund_type='full'`; `328:35` allows one full return per original. |
| `services/payroll.js:5788–5827,5953–5976` | Payroll writes linked `payroll_payment_movements` and `finance_transactions` with actual-payment and recognition dates; reversal has an origin link. | Preserve its writer and permissions. Later consume one linked fact, not both rows as separate cash movements. Payroll adaptation is outside the first manual block. |
| `services/banquetDeposits.js:920,1235,1606` | Banquet deposits have their own manager report, confirmation and accounting-verification workflow. | Exclude banquet/group deposits from the first manual booking-payment flow until an explicit adapter and ownership rule are reviewed. A manager report alone is not sufficient evidence of received money. |

The minimal alternative to overhauling fiscal-scoped tables is a small manual journal using existing account IDs, not another copy of the fiscal engine. It needs no provider, outbox, legal-entity configuration, tax codes or invented register. Import/projection of fiscal payments is a later adapter, not a second payment confirmation.

## Source ownership and correction map

| Event / current writer | Fact or projection | Rule for the proposed manual block | Correction / reversal |
| --- | --- | --- | --- |
| Booking save → `services/bookingFinanceSync.js` | Full-price income projection; not receipt evidence. It expects one non-certificate income row per booking (`:185–210`), can overwrite it (`:266–294`) and delete it on cancellation/preliminary (`:87–94,239`). | Never count this row in actual account cash or add one such row for every deposit. Do not change booking identity/detail or sync semantics in the manual block. | Correct booking-value data through its current owner; cancellation does not erase confirmed cash receipts. |
| New manual receipt/expense command | Confirmed physical/bank movement, with amount, account, effective time, actor, category when applicable, source and immutable request identity. | One service transaction is the sole writer. Draft form state does not affect balances. Manual source cannot claim an existing fiscal/payroll/banquet operation. | Append a linked reversal/correction with reason; retain the original confirmed fact. |
| New manual booking receipt | A receipt linked to one eligible non-group booking; several receipts can settle its value. | Sum receipt facts less confirmed refunds. Read current booking value and business through existing server validation. Do not make the editable legacy `paid_amount` field a second primary ledger. | Refund references an original receipt; cumulative refunds cannot exceed its unreversed confirmed amount. |
| `POST /api/finance/debts/:bookingId/mark-paid` | Existing setter of `bookings.paid_amount/payment_status` (`routes/finance.js`, named handler); no receipt is created there. | Existing history stays legacy. A booking enrolled into the manual flow must reject this competing setter and use the new command; re-check enrollment inside the write transaction. Enrollment/cutover is not inferred from a nonzero field. | Legacy reconciliation is a separate approved data decision; do not manufacture prior receipts. |
| Fiscal sale/refund → existing `services/payments/*` | Payment fact and fiscal state are distinct; existing workflow owns both. | Outside manual writes. No manual duplicate with the same provider/order identity; do not expose a fiscal sale as a manual receipt to bypass requirements. | Existing fiscal refund/recovery only. A failed/unknown receipt does not authorize replaying a payment or manual refund. |
| Payroll / banquet deposit writers | Domain-owned financial evidence with distinct lifecycle. | Display source/coverage limitations; do not count a second manual copy. New manual journal enrollment cannot silently include accounts whose balance also depends on unadapted writers. | Existing domain workflow only until its adapter is separately approved. |
| Opening balance / own-account transfer / reconciliation | Balance baseline / neutral cash movement / observation. | Opening balance is not new income; transfer is not revenue/expense; reconciliation records an observation, not a balancing transaction. | Explicit correction with an audit reason; no hidden overwriting of a confirmed opening balance or closed shift. |

For the first local block, use newly created synthetic accounts and eligible synthetic non-banquet bookings with zero legacy payments, no certificates and no fiscal/payroll/deposit links. That keeps the example honest without claiming old or shared accounts are ready for production cutover. The manual service must enforce eligibility, not rely on a label in the UI. Important coexistence limitation: existing payroll account options include all active finance accounts (`routes/payroll.js:318–324`), so an empty new account is not permanently isolated merely because no payroll row exists today. Preventing future writes by every unadapted domain requires a separately reviewed account-routing/adapter contract before production enrollment; do not add a hidden database trigger that changes payroll behavior under this local-only scope.

## Concrete command and balance contract

The following are behavioral contracts, not proposed SQL or a promise to expose each as a separate route.

1. **Start account tracking:** explicit business/account, cutoff timestamp, opening amount and actor/reason. One baseline per enrolled account. Historical transactions included in that opening amount must not be replayed. Zero is valid. No inferred production enrollment.
2. **Record receipt/expense:** positive integer kopecks as a decimal string on the wire; UAH only. Use server-recorded audit time plus explicit effective time in Europe/Kyiv. Account and category must belong to the selected business and be active for new use. Mandatory category for ordinary new expense/income; neutral operations have an explicit kind instead of a misleading revenue category.
3. **Receive partial booking payment:** one actual receipt per action, its chosen account, amount and source booking. Default to no overpayment; display any legacy payment field separately until reconciled. For enrolled eligible bookings, the new finance payment view uses confirmed receipt facts; do not overwrite all existing booking DTOs or P&L projections to make the demonstration pass. The compatibility gap must be visible before production adoption.
4. **Transfer:** one command, two different enrolled accounts in the same business/currency, equal and opposite legs, one DB transaction. Lock accounts in stable order. Default first scope is cash-to-cash without fee; bank settlement/fees and cross-business transfer are separate extensions.
5. **Refund/reverse:** original fact reference, positive amount, reason, effective time and actor. Same-account refund by default; lock the original and validate remaining refundable amount within the transaction. A pending request is not cash out. Cancellation of a booking is never implicit refund confirmation.
6. **Manual shift:** open for one cash account, at most one open shift per business/account; movement records carry its shift identity. Do not classify by `created_at >= opened_at`. Close records expected amount, actual count, difference and explanation. It never closes Checkbox or another till. Posting a cash movement requires that account's open shift.
7. **Retry/concurrency:** idempotency key scoped to actor/business/command and a canonical request fingerprint. Same key/same content returns the original outcome; changed content conflicts. Concurrent receipts/refunds/transfer/close must not oversettle, overrefund, split a transfer or miss a just-posted cash movement. The post/close paths share the account/shift lock protocol.

An account balance is its explicit opening baseline plus the signed sum of confirmed movement legs after its cutoff. Refund/reversal legs are already signed entries in that sum; never subtract them a second time. A shift opening count is a checkpoint of that balance, not another opening-balance contribution. Expected closing cash is opening cash plus that shift's assigned net movements. P&L recognition remains an independent contract; do not add cash receipts to existing full-price booking income.

## Policy choices and recommended defaults

| Decision before dependent implementation | Recommended bounded default |
| --- | --- |
| Which accounts and bookings can enter the first flow? | Synthetic new manual cash/card/bank accounts for local tests; partial payments only for eligible standalone synthetic bookings with no pre-existing payment evidence. Production enrollment is a later exact data boundary. |
| Existing `paid_amount` and banquet/certificate evidence? | Do not backfill or treat them as confirmed receipt rows. Reject manual enrollment with conflicting legacy/domain-owned payment evidence until an adapter/reconciliation decision exists. |
| Money precision? | New facts use integer kopecks and string serialization using existing helpers. Legacy UAH remains unchanged; no rounding into its integer fields. |
| Overpayments and negative cash? | Reject new overpayment and insufficient-cash movements in the first flow. Do not invent loans/credit limits or silently clamp values. Existing inconsistencies remain an explicit exception. |
| Backdating / closed shift? | Permit a truthful effective date only inside the current open shift; closed-period corrections post in the current open shift with an origin link. No quiet historical balance rewrite. Bank-account dating has no fake cash shift. |
| Who may use it? | Existing finance-page revenue access plus `finance.manage`; preserve business access checks. Existing fiscal/payroll permissions remain authoritative for those domains. No role or permission changes. |
| P&L recognition? | Keep existing legacy P&L behavior and label the new display as actual money movement. A company-wide accrual/receipt recognition policy is not part of this block. |
| Split tender / acquiring / invoices / supplier debt? | Multiple separate receipts can settle the eligible booking. A single mixed receipt, acquiring settlement adapter, invoicing and payables are out of scope. |

Any deviation that would include fiscal, payroll, banquet/certificate writers or change booking detail/identity contracts requires a revised exact scope, not an opportunistic addition to this block.

## Likely implementation surfaces requiring authorization

The exact migration number must be selected after rechecking the current branch. No SQL, schema migration or protected code was authored by this draft.

| Surface | Expected bounded change | Boundary |
| --- | --- | --- |
| New `services/financeMoneyMovements.js` (proposed) and focused tests | Manual command transaction, integer-money validation, source ownership, locks, idempotency and reversal/balance logic. | Protected financial/payment behavior; needs explicit local implementation approval. |
| `routes/finance.js` | Scoped manual commands/reads, enrollment eligibility, guards against the legacy mark-paid setter for enrolled bookings and legacy manual transaction writes on enrolled accounts; reuse existing access middleware. | Do not modify role definitions, payroll endpoints or provider APIs. Existing non-enrolled legacy behavior is preserved. |
| `js/finance-page.js`, `finance.html`, scoped finance CSS, `js/api.js` only if needed | Account selection, actual-money view, two manual tills, eligible receipt/refund workflow and honest coverage/source labels. | Preserve existing UI patterns and permission checks; no new dependencies. |
| New durable file under `db/migrations/` | Candidate minimal storage: manual operation headers plus account legs, explicit per-account cutoff and booking-ownership/enrollment metadata, unique idempotency/source identities, reversal references and business-safe constraints. Exact names/columns reviewed before implementation. | New local schema only, no real-data backfill, no production execution, no changes to `db/index.js` ownership. Reuse `finance_accounts`; no parallel account catalog. |
| `cash_register_shifts` via that new migration | Add nullable account identity and exact minor-unit fields for new manual shifts while retaining legacy fields/rows. Replace the business-wide open-shift uniqueness with separate legacy-null-account and manual-business/account guards. | The existing `227` index is not simply dropped without equivalent legacy protection. Old open shifts remain legacy and are not assigned or closed automatically. |
| `services/bookingFinanceSync.js`, `routes/bookings.js`, `services/booking.js`, canonical `js/booking*.js`, `config/timelineProtectedSurface.js` | Read-only dependencies for the first block. | No protected identity/detail mapping, manifest, full-price sync or global payment-field propagation change. Their future adapter requires an exact follow-on scope. |
| Existing `services/payments/*`, `routes/payments.js`, migrations 316/319/328 and later fiscal hardening | Read-only reuse assessment; import existing pure money helper. | No weakening fiscal constraints, provider calls, full-to-partial fiscal refund changes or fake fiscal bindings. |
| Payroll/deposit/certificate services and `middleware/auth.js` / `js/auth.js` | Read-only dependencies and regression checks. | No new writer, privilege changes or hidden duplicated payment. |

The journal alternative is deliberately small: source-preserving manual movements and transfer legs, not a general ledger, ERP, bank integration or generic workflow builder. If the local implementation cannot enforce source ownership and the boundaries above without changing protected domain writers, stop that dependent change and report the exact boundary; finish independent tests/UI work.

## Proof required before considering a production cutover

Use Node 22/npm 10 and isolated PostgreSQL fixtures. Extend the existing isolated finance test suite; do not run mutation tests against production.

- Two businesses; two cash tills and a non-cash account. Cross-business account/category/booking IDs fail on the server. Existing finance/fiscal/payroll capability boundaries remain intact.
- Opening 5,000.00; expense 800.25 yields 4,199.75 without new revenue. Shift reopening does not add the baseline again.
- Booking 10,000.00; receipt 3,000.00 to one account; later 7,000.00 cash to the selected till. Debt reaches zero while the full-price booking projection is counted zero times in actual cash. Changing the event date does not rewrite receipt time.
- Same request retry, changed-body replay, simultaneous receipts and refunds, transfer competing with shift close, and parallel shift opening have deterministic results.
- Transfer 2,000.00 moves both sides atomically and changes neither combined money nor P&L. Refund/correction retains the original record and its source.
- An account with unadapted fiscal/payroll/deposit/legacy payment evidence cannot silently enter the local manual contract. No provider/outbox job is invoked by a manual action.
- Closed-shift mutation, legacy mark-paid on an enrolled booking and direct edits that would bypass command ownership are rejected. UI error is not zero; partial feature coverage is visible.
- Migration rerun and startup compatibility preserve existing null-account shifts and fiscal constraints. Run migration governance, syntax, relevant finance/payment/payroll regression checks and protected-surface guard; browser clicks in both themes and narrow viewport.

No implementation or runtime checks are claimed by this document. This readiness review inspected code and schema text only. The local build is not production-ready merely because synthetic scenarios pass: production needs an exact account/booking cutover inventory, adapters or exclusions for current domain writers, owner approval of the remaining policy choices, a separately authorized migration/release envelope and live verification.

## Proposed single next confirmation, after the current Green block is verified

This is a proposal for the root agent to present once the current Green code changes and checks are complete; it is not an active authorization and should not interrupt that work. One confirmation covers only the following local financial implementation and isolated schema tests. It does not authorize production data mutation or delivery stages.

```text
УВАГА · FIN-MONEY-01-LOCAL

Дія: реалізувати й перевірити локально ручний рух коштів, дві каси та часткові оплати за контрактом docs/FINANCE_MONEY_FLOW_CONTRACT_DRAFT.md.

Наслідки:
1. З'являться точні факти руху коштів, прив'язані до рахунків і ручних змін.
2. Для нового локального сценарію будуть створені окремі міграції та тести на синтетичних даних.
3. Для включених у сценарій бронювань конкуруюче ручне «сплачено» буде заблоковане; історичні реальні записи не змінюються.
4. Checkbox, payroll, банкетні депозити, сертифікати, ролі та захищений контракт бронювання залишаться поза змінами.
5. Production-міграція, реальні залишки, commit/push/deploy та підключення старих рахунків потребуватимуть окремого дозволу.

Межі: лише codex/finance-workflow-wave1 у finance-workflow-20261007; локальні файли й ізольована тестова БД; до 6 годин від підтвердження; без production-запитів на зміну даних і без викликів провайдера.
Відкат: відкочуються лише зміни цього блоку; тестова БД одноразова; production не зачіпається. Чужі та поточні Green-зміни зберігаються.
Потрібний дозвіл: «Дозволяю блок FIN-MONEY-01-LOCAL».
```

The reason for explicit confirmation is the repository `AGENTS.md` Red boundary for payments/financial behavior and the schema boundary, not uncertainty about ordinary Green UI work. After confirmation, remain within the proposed files, data and time boundaries; do not ask again for an already authorized in-scope local step.
