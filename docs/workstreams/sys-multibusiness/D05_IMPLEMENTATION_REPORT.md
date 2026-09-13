# SYS-MB-D05 — Remaining domain ownership

Date: 2026-09-12. **PARTIAL_LOCAL_IMPLEMENTATION / HOLD_ENABLED_UNMIGRATED_DOMAINS**.
This report records independent completed patches and the protected/unresolved
remainder. It does not claim D05, global SYS-MB, production cutover or live QA complete.

Worktree: `C:\Users\Plotva\OneDrive\Документи\EventGenix\.worktrees\sys-mb-auth-p0-20260912`.
Branch: `codex/sys-mb-auth-p0-20260912`.
HEAD/base: `a5180def01a1e47f8f4fc75e2f7a43092f205828`.
The 204 source/audit/artifact entries from `LEGACY_OWNERSHIP_TASK4_VERIFICATION.json`
matched before work. They overlap and are not a distinct-file count. Earlier
cumulative implementation is still uncommitted; it was not reset or replaced.

## Implemented independent packages

1. **Warehouse service containment and confirmation atomicity.** Require explicit
   trusted context at every effectful intake service entry, recheck the current
   registry and deny missing/unmigrated context before data/provider work. CRM
   forwards its server-resolved context; Telegram cannot manufacture Park.
   Match candidates use their stored stock business context.
   Hold the checked location with `FOR SHARE`;
   require one successful final intake receipt before COMMIT. Suppressed parent
   UPDATE rolls back stock/history/movements with 409. Actual PostgreSQL verifies
   both new stock and restocking, competing location changes, repeat and concurrent
   confirmation. This does not establish the unowned draft's business.
2. **Income notification containment.** New events carry the inserted transaction
   ID/context and deterministic event key. Every worker attempt checks a stored
   income row and current legacy namespace availability before reading rules or
   executing actions. Missing/foreign/membership source becomes terminal blocked;
   temporary lookup failure remains retryable. No amount or formula changes.
3. **Private chat and AI containment.** Apply the existing legacy guard after
   authenticated chat access and to Kleshnya JWT routes. The AI engine refuses
   missing/unresolved/membership actors before data/provider reads. Only verified
   pre-cutover Park compatibility retains that namespace. The local WebSocket
   recipient guard also rechecks the account's explicit default context and
   membership before unowned channel/transcript delivery; it does not infer
   channel ownership or change the socket protocol. Secret bridge and background
   transcript storage retain separate protected contracts.
4. **Intake unavailable UI.** Two existing read wrappers retain error codes; the
   warehouse page distinguishes denied/loading-error/true-empty states, clears
   stale cards, offers retry and rejects late responses. Seven DOM/VM tests run
   through the actual wrappers and page; no real provider or upload is required.

Detailed source graphs, bug reports, exact files, retry behavior and evidence:
`D05_INTAKE_REPORT.md`, `D05_INCOME_NOTIFICATION_REPORT.md`, `D05_CHAT_AI_REPORT.md`.
The new focused unit tests join the existing explicit npm verification baseline;
there is no dependency, lockfile, version, CI settings or release change.
The 26 D05 source/test paths and their prior/current hashes are listed individually
in `D05_VERIFICATION.json.checkpointChanges`; the whole Git diff also contains
earlier D01–D04 work and must not be presented as this task's patch alone.

## Evidence-based domain matrix

`SUPPORTED` certifies only a named, tested boundary. `BLOCKED` identifies either
executable containment (stated explicitly) or a pending implementation. An enabled
`NOT_MIGRATED` path remains a global cutover blocker; hiding its menu/module is not
proof of denial. No source-only observation is presented as live PASS.

| Domain / implementation owner | Ownership and ingress/read/write | Retries / idempotency | Status and remaining availability |
| --- | --- | --- | --- |
| Warehouse photo intake — warehouse + Telegram maintainers | Draft/photo tables lack durable owner. CRM and every effectful service entry contain missing/non-Park/membership context before data/provider work. No Telegram context binding is invented. Stored stock owner scopes matching and writes. | Confirm transaction/replay and location check tested; each service retry rechecks registry. Pre-cutover create dedup/provider concurrency and partial photo persistence remain unresolved. | **SUPPORTED** narrow local confirmation atomicity/matcher; **BLOCKED** missing/membership service and CRM intake. Durable ownership **NOT_MIGRATED**; Telegram envelope registration/generic replies remain a protected integration residual. |
| Income notifications — notification/rule-engine + finance maintainers | Inserted finance source ID/context; worker rereads actual income type/owner before global rule access. No owned channel/rule model yet. | Source/registry check on every attempt; deterministic publication key; terminal ownership denial versus retryable dependency error. Existing finance-commit/event dual write and legacy per-action replay remain. | **BLOCKED** membership global delivery with unit/actual-PG proof. Explicit pre-cutover legacy Park only; owned destination migration **NOT_MIGRATED**. |
| General chat — messenger maintainer | Channels/members rather than business ownership. JWT HTTP and unowned WebSocket delivery are contained; direct channel services/background workers remain separate ingress. Existing booking-linked socket guards remain. | Fresh membership/legacy admission per socket delivery; channel sequence/client-message dedup and scheduled-message claims do not establish tenant ownership. | **BLOCKED** migrated/non-Park HTTP and unowned socket delivery with executable tests; overall **NOT_MIGRATED**, enabled background/storage gaps. |
| Personal AI/transcripts — assistant + bridge maintainer | JWT routes, engine and username socket delivery now contained; actorless engine cannot default to Park. Account/session transcript storage, secret bridge and direct greeting paths retain separate contracts. | Delivery rechecks membership; no new business-bound transcript/job retry model. A username/session is insufficient when content includes business data. | **BLOCKED** guarded HTTP/engine/socket delivery; overall **NOT_MIGRATED**, secret bridge/transcript/background residual. |
| Staff/HR/payroll/certificates — respective domain maintainers | Global staff/report/certificate identities, multiple direct and booking/customer adapters. Membership does not establish employment, salary allocation or redemption owner. | Existing installment/ledger allocation, fingerprints, period locks and payment idempotency retained. They do not supply missing report/staff ownership. | **SUPPORTED** tested finance account/category/booking boundary; salary and finance staff/certificate references **BLOCKED** narrowly. Other reads/adapters **NOT_MIGRATED**, executable handler exposure and source evidence. |
| Task notifications / legacy Telegram — task + Telegram maintainers | WebSocket task delivery has the prior fresh stored-source guard. External outbox uses task/owner identity; Telegram chat/digest/retry transport has no complete approved business binding. | Outbox lease/ack/hash and Telegram retry counters exist; external recipient ownership/revoke policy is incomplete. | **SUPPORTED** prior narrow WebSocket boundary, not newly certified external delivery. External path **NOT_MIGRATED**, registered/config-dependent writer. |
| Omni / Leads / Hermes ingress — individual integration maintainers | Scoped conversation/upsert/fiscal-like connection controls vary; custom credentials do not supply a fresh human membership. Active organization/machine-principal registration is incomplete. | Existing conversation/provider-ID and MD relation replay controls retained; late receipt/deactivation principal policy pending. | Narrow source controls documented; complete ingress **NOT_MIGRATED**, enabled/config-dependent. Protected implementation **BLOCKED** on contracts. |
| Payments / Checkbox / report-bot / personal accounts — fiscal + bot maintainers | Fiscal operation/profile/binding boundaries already exist. Legal entity/business policy, machine recovery and report-bot/personal account ownership require separate contracts. | Persisted fiscal replay/outbox/reconciliation must not be discarded on cashier revocation. Report-bot dedup does not authorize the selected business/account. | Full domain **NOT_MIGRATED / VERIFICATION_PENDING**; protect existing fiscal invariants. Report-bot remains an enabled custom-key finance writer. No payment operation performed. |
| Art — Art maintainer | Global brand/template/content/approval identities; direct APIs are not denied by a module registry label alone. | Existing status transitions are not durable business-owned job/replay state. | **NOT_MIGRATED**, source-confirmed enabled API gap. Separate containment/migration **BLOCKED** on exact Art scope and ownership policy. |

For protected work, see `D05_PROTECTED_PEOPLE_FINANCE_CONTRACT.md` and
`D05_PROVIDER_PAYMENT_ART_CONTRACT.md`: concrete file/function seams, missing
business choices, separate permission scopes and executable acceptance cases.
Named maintainer roles are responsibility assignments for the next work, not
invented identities of actual employees/owners. OWN-07/08 remain PENDING.

## Verification and limits

`D05_VERIFICATION.json` is the final source/artifact checkpoint and records the
exact commands/counts. Evidence directories are `.codex-temp/sys-mb-d05/` and the
preserved prior task directories. Fixture setup/cleanup uses generated local
PostgreSQL databases; collector/provider/production credentials were not loaded.

- Intake: red PostgreSQL/service reproductions; final 24/24 unit/CRM/DOM checks
  and 15/15 actual-PG checks, including cutover replay, strict stock matching and
  prior atomicity. Initial 13/13 PG and 12/12 unit logs are retained.
- Income: five pre-fix unit failures, then the separately reproduced expense-ID
  case; final 30/30 unit/route/outbox and 9/9 actual-PG checks.
- Chat/AI: five pre-fix failures; new 8/8 tests, 68/68 focused regressions and
  103/103 route-smoke. These use actual routers and synthetic resolved principals,
  with mocked persistence/providers; they are not full JWT/PG/live acceptance.
- WebSocket: final 45/45 event-access/socket unit checks and 21/21 actual socket
  plus PostgreSQL checks (20 scenarios and parent). A stored NULL default was
  reproduced delivering a real loopback chat event before the raw-default guard.
  Explicit timeline-module fixtures repair old D03 fixture drift; no runtime
  module check was weakened. These are local actual-app components, not live QA.
- Protected evidence: 14/14 finance/legacy unit and 13/13 actual-auth HTTP/PG tests
  verify narrow existing containment. Four characterization assertions demonstrate
  six unowned read handlers across Park/Dar/another organization; that reproducer
  passing means **exposure confirmed**, not isolation PASS.
- Extra caller sweep: 60 PASS / 6 FAIL in unchanged
  `tests/telegram-startup-skip.test.js`, whose startup VM lacks an `omni-health`
  module mock already imported by unchanged HEAD `server.js`. This non-baseline
  fixture drift is retained in `chat-ai-callers.log`; unrelated code was not edited.
- Final **`npm test` PASS, exit 0** after all service/WS edits. The run includes
  canonical runtime, syntax, protected-surface checks, unit/regression and UI smoke.
  All 211 frozen source/audit hashes matched after the run. Detailed outcomes are
  stated in the manifest.
  Historical/initial logs are retained rather than replaced. Overlapping sweeps
  repeat checks and their counts must not be summed as unique acceptance cases.

No production/live database, actual owner mapping, external provider/send, migration,
payment, salary/financial data mutation, secrets, HR/Art runtime, protected booking
fields, global menu/router/theme, dependency, commit/push/deploy was changed or run.
Local fixture INSERT/UPDATE/DROP operations target only their disposable databases.

## Remaining work and next action

- Keep Task 4 **BLOCKED_SOURCE_MAPPING_AND_POLICY**; Task 5 patches do not approve
  OWN-01–08 or fill its absent mapping.
- Reopen neither intake nor chat/AI membership modules from these partial fixes.
  Complete actorless/background/storage paths plus actual owner mapping first.
- **READY:** review these local diffs and run independent acceptance for already
  supported domains; review the exact protected contracts.
- **BLOCKED:** protected HR/certificate/payment/Art changes and historical owner
  migrations need their stated policies, actual mappings and exact scope.
- **HOLD:** global SYS-MB/D06 completion while any enabled NOT_MIGRATED ingress,
  read/write, background or indirect adapter remains. Local patches are not
  production containment until delivered and verified in a separate release task.

Recommended next action: review OWN-07 domain policies and authorize the smallest
protected containment package first, including indirect certificate adapters;
then implement approved durable ownership per domain. Preserve already accepted
payments/reconciliation semantics and salary formulas throughout.
