# D05 — Income notification containment

Date: 2026-09-12. Branch `codex/sys-mb-auth-p0-20260912`.
Base `a5180def01a1e47f8f4fc75e2f7a43092f205828`.
Scope: local notification admission/dispatch only; no financial formula, amount,
payroll, payment, schema or external transport changes.

**Status: BLOCKED for membership/global-rule delivery; legacy pre-cutover Park
compatibility retained. Full tenant-owned notification delivery is NOT_MIGRATED.**

## Reproduced problem and decision

`routes/finance.js:POST /transactions` commits a business-scoped transaction, then
publishes `finance.income`. Previously its event contained only amount/description/
category. `services/eventBus.js:processEventRules` selected global matching rules
and executed them without validating the source business. Migration 098 configures
`chat_finance_income` to write into fixed channel 3. A valid Dar financial write
could therefore enter the same global rule namespace as Park. Other configured
actions could send Telegram, create tasks or print jobs; the queue's actual live
rules were not read.

The new test reproduces rule execution for missing ownership, mismatched source,
membership and inactive targets, and replay after cutover. Before the patch five
of six tests failed because a rule action executed. This is executable local
evidence with synthetic rows and a harmless action spy, not a live disclosure.

An owned destination/rule/job schema and historical mapping do not exist yet.
The minimal independent fix therefore contains this global namespace instead of
assigning channel 3 to a business or broadcasting to global creators.

## Implemented boundary

| Stage | Ownership/read/write contract | Retry and idempotency |
| --- | --- | --- |
| Producer | Add canonical inserted `transactionId` and `businessContext` to the existing event. HTTP transaction response and amount handling stay unchanged. | Explicit event key `finance.income:<businessContext>:<transactionId>` deduplicates repeated publication of that same event. It does not make two separate HTTP transaction creations idempotent. |
| Worker source check | `assertFinanceIncomeNotificationScope(db,payload)` requires a valid ID and explicit context; reads only an actual income source ID/context and requires an exact non-null stored owner match. Expense IDs cannot authorize income events. | Runs at the beginning of every `processEventRules` attempt before internal/global rule lookup, including queued legacy events and replay. Missing/foreign/unowned source never defaults to Park. |
| Legacy namespace check | Reuse `loadLegacyBusinessSurfaceAccess(...,'finance_notifications')`. Only explicit Park with current pre-cutover compatibility state may keep global rules. Membership, other contexts and inactive registry entries are denied. | Current registry is checked on each attempt; no grant cache. The historical no-registry Park compatibility case is preserved. This does not assign a business owner to a global rule or channel. |
| Ownership denial | Existing event convergence path records `terminal_failed`, failure class `finance_notifications_not_migrated`, with a static message. No rule/destination read or action occurs. | Repeating the same denied event produces no domain side effect. The existing failed-event/dead-letter workflow remains responsible for terminal records; no new automatic replay/reassignment was added. |
| Temporary lookup failure | Static `finance_notification_scope_unavailable` error becomes retryable `failed`, without driver details in the error. | Existing worker retry limits/backoff apply. The next attempt rechecks the original source/context before any action. |
| Other event types | Existing event/action handlers remain unchanged. | Existing outbox regression tests pass; this patch is not a general rule-engine migration. |

No historical event is repaired from its amount, creator, description or a similar
transaction. Adding source fields to new events does not authorize old payloads.
The guard is conservative about a deleted source: it blocks instead of delivering
an unverifiable historical notification.

## Files and checks

- `services/financeIncomeNotification.js`: dependency-free source/legacy-scope guard.
- `services/eventBus.js`: income-only admission and error classification.
- `routes/finance.js`: additive source identity and event idempotency key.
- `services/legacyBusinessSurface.js`: named notification descriptor, same existing policy.
- `tests/d05-income-notification.test.js`: executable rule denial/retry and compatibility controls.
- `tests/finance-business-isolation.test.js`: actual route fixture verifies unchanged financial result and emitted source identity.
- `tests/integration/d05-income-notification-postgres.test.js`: disposable actual PostgreSQL convergence/ownership evidence; final counts are recorded in the D05 verification manifest.

`income-red.log` records the five pre-fix failures; `income-type-red.log` records
the additional expense-ID case found during independent review. `income-unit.log`
records the initial 29/29 PASS; the final additional-case run is
`income-unit-final.log`. Logs are under `.codex-temp/sys-mb-d05/`.
PG/final baseline results belong to `D05_VERIFICATION.json`; no fixture result is
production or live evidence.

## Remaining contract and reopening

Implementation owner: internal notifications/rule-engine maintainer, with the
finance and chat domain owners. Required choices: business-owned rule/destination
registration, permitted machine principal, finance audience/action policy,
source retention, historical event treatment, and inactive-business behavior.
OWN-07/08 and the relevant chat/provider contract remain pending.

Before enabling membership delivery, persist the source/rule/destination/business
identity and per-action replay state. Revalidate permissions/registry at the
transaction/dispatch boundary, including a cutover racing an already admitted
legacy action. Current separate SELECT checks do not serialize that transition.
Global-rule execution remains best-effort: publication is after the finance
commit; action failures can be swallowed by the existing rule loop, and a
pre-cutover successful action replay is not certified exactly-once. These are
explicit remaining limitations, not solved by the new event key.

General task notification outbox is separate: `notificationOutbox.js` stores
task/owner event identity, payload hash, worker lease and ack/fail state; its
payload allowlist has no business context. Hermes/Telegram dispatch still needs a
fresh source-owner/audience policy. `taskNotifications.js` WebSocket delivery has
the earlier fresh task-business guard in `websocketEventAccess.js`; that narrow
path does not certify external notification delivery. No outbox claim, ack,
Telegram send, provider invocation, queue cleanup or production mutation ran here.
