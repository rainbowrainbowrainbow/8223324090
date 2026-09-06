# Reusable Shared Test day: local acceptance

Date: 2026-09-05. Production impact: no. Status: LOCAL IMPLEMENTATION COMPLETE,
READY FOR COORDINATOR REVIEW. This is evidence, not release authorization.

Owner block: `PARK-DAR-REUSABLE-TEST-DAY-LOCAL`, explicitly authorizing additive
schema, endpoints, local server rules/UI, disposable PostgreSQL and mock Checkbox
tests. Production DB, Railway, real provider calls, secrets/permissions, production
acceptance, commit, push and deployment were excluded and were not performed.

Source: `codex/park-dar-cashier-followup-20260905`, unchanged HEAD/base
`9ea61f1ea6c38b6f218bbc4b9ceda3f772bedbd5`. Worktree:
`C:/Users/Plotva/.codex/worktrees/0eb7/EventGenix`.

## Implementation decision

The baseline close could only follow global payment acceptance OFF. PD3 adds an
exact physical Shared Test stop as an alternative, preserving the existing owner,
both-route authority, opener binding, fresh identity, blocker and durable close
checks. Stop, canonical close and next-day resume remain separate explicit actions.

- Migration 352 adds an initially empty history table. Each shift has one row;
  a composite FK fixes its shift/profile/register identity. A partial unique index
  allows only one active `draining`/`closed` row per physical register. State/time,
  owner and key checks plus triggers reject history deletion, rewrites and reverse
  transitions. Canonical shift CLOSED atomically records `closed` and its audit.
- `POST /api/payments/shifts/:shiftId/phase1-drain` accepts an empty body and
  Idempotency-Key; `POST /api/payments/test-drains/:drainId/resume` requires exact
  `{ "confirmNextTestDay": true }`. Both use `X-Fiscal-Route-Option`, existing
  `fiscal.shift.close` middleware and canonical integration-owner authorization.
  No new permission, bypass or ordinary-cashier grant was introduced.
- Scope must be exactly PARK `park_test` and DAR `dar_test`, both test routes on
  the same physical register/group. Resume requires the same initiating owner and
  route, unchanged fingerprint/binding, local `closed`/`CLOSED`, the exact close
  operation `fiscalized`, no newer/unresolved shift and zero register-wide blockers.
- Provider identity/current shift/exact CLOSED detail are freshly read outside DB
  transactions. Evidence expires after 30 seconds, including lock wait. The final
  transaction reauthorizes and rechecks under the shared physical advisory lock.
  Stop/resume permit GET only; missing/expired cached provider access fails closed
  instead of sending a login. They do not open/close shifts, sell receipts or set
  environment, global, route or register acceptance flags.
- Catalog/admission creation, unpaid confirmation and new shift/blocker admission
  use the same physical lock and stop predicate. Existing idempotent confirmed
  responses and already-accepted worker recovery remain usable. Unpaid drafts and
  historical rows are retained. Global acceptance OFF still blocks new sales after
  resume; resume returns `requiresReadinessRefresh`, not a ready-to-sell guarantee.
- Same-target retries return the original row; conflicting keys/scopes fail.
  Historical cycle A replay also reports current active cycle B and cannot release
  it. There is no midnight/reload/restart reset, history cleanup or auto-resume.
- UI uses shared confirmation/accessibility helpers, fresh state/queue refresh,
  stable per-target retry keys, in-flight guards and explicit disabled/error states.
  PD1 draft recovery and PD2 layout fixes are retained.

## Changed areas

| Area | Files |
| --- | --- |
| Additive DDL | `db/migrations/352_shared_test_payment_drains.sql` |
| Lifecycle and lock | `services/payments/sharedTestDayService.js`, `services/payments/testDrainGate.js` |
| Existing writer/close paths | `services/payments/paymentService.js`, `catalogSaleService.js`, `cashierOperationsService.js`, `paymentReadinessService.js` |
| HTTP and UI | `routes/payments.js`, `cashier-payments.html`, `js/cashier-payments-page.js`; existing PD2 CSS retained |
| Coordinator corrections | `services/checkbox/webhookService.js` serializes lookup admission; `tests/checkbox-webhook-reconciliation.test.js` verifies fresh scope; lifecycle service and PG integration test cover current actor authority |
| Regression tests | `tests/shared-test-day.test.js`, `payment-workflow.test.js`, `payment-readiness.test.js`, `catalog-sale.test.js`, `tests/integration/catalog-sale-local-provider.integration.test.js`, `tests/browser/shared-test-day-browser-smoke.js` |
| Test registration | `package.json` adds the lifecycle unit test to the existing unit command; no dependency, lockfile or version change |
| Documentation | This report, accepted proposal, follow-up acceptance/progress and implementation status |

Complete PD1–PD3 paths and SHA-256 values are in
`output/park-dar-review-manifest.json`; patch is `output/park-dar-followup.patch`.
No executable release SHA exists because commits are forbidden in this block.

## Verification performed

Node 22.23.1 / npm 10.9.8. Existing local dependency installation via NODE_PATH;
cached offline Playwright. All provider requests targeted the loopback mock only.

| Check | Actual result and evidence |
| --- | --- |
| Targeted unit regression | 154/154 PASS, `output/park-dar-pd3-targeted.log`; payment/catalog/close, PD1 and new lifecycle validation/gate/freshness cases |
| Repository baseline | `npm test` PASS, exit 0, UI 1310/1310; `output/park-dar-pd3-npm-test.log`. Includes runtime/version, auth/action contracts, syntax, migrations, Checkbox safety and existing unit gates |
| Disposable real HTTP/PG/outbox | PASS, `output/park-dar-pd3-postgres.log`, `output/catalog-sale-local-qa-report.json`; two sequential PARK/DAR shifts/cycles, four catalog receipts, both tenders, admission rejection regression and same-UUID uncertain receipt recovery |
| Stop/close/resume | Confirmed pending receipt completes after stop; close blocks before recovery; stop blocks both routes; canonical close works with global acceptance ON plus exact local stop; fresh closed resume and next normal shift work; global OFF result stays OFF |
| Replay/concurrency | Concurrent duplicate/different-key stop and duplicate resume converge; one audit per transition; stale cycle A resume leaves active B stopped; no duplicate provider receipt/close UUID |
| Fail-closed resume | Wrong owner/route, mock non-test register, provider read unavailability, failed outbox job, early resume and stale/foreign/current-open evidence rejected; active stop retained |
| SQL invariants | Reapply migration with active stop; exact FK, second active stop, identity rewrite and DELETE rejected; resumed-to-closed reversal rejected |
| New UI browser | PASS, `output/park-dar-pd3-browser.log`, `output/playwright/park-dar/test-day/report.json`; cancel/Escape, lost stop response after server acceptance, reload, CLOSED still blocked, failed resume then stable-key retry, no implicit close/open/order requests |
| PD1/PD2 browser reruns | Canonical cashier and synthetic-auth two-tab next-customer PASS, `output/park-dar-pd3-{cashier,next-customer}-browser.log`; layout 16/16 PASS, `output/park-dar-pd3-layout-browser.log` |
| Visual review | Shared Test CLOSED panel at 1152 and 390, light/dark; labels/buttons fit without overlap, four PNGs in `output/playwright/park-dar/test-day/`. Existing summary matrix retained |
| Scope | `git diff --check`, patch reverse-check and manifest hash verification; no unrelated source changes |

Commands (from this worktree, with existing dependencies available):

```powershell
node --test tests/shared-test-day.test.js tests/checkbox-webhook-reconciliation.test.js tests/cashier-next-customer.test.js tests/catalog-sale.test.js tests/catalog-sale-manual-ui.test.js tests/payment-readiness.test.js tests/fiscal-cashier-operations.test.js tests/payment-workflow.test.js
node scripts/run-isolated-postgres-tests.js catalog-sale-local-qa
npx --offline -y -p playwright node tests/browser/shared-test-day-browser-smoke.js
npx --offline -y -p playwright node tests/browser/cashier-payments-browser-smoke.js
npx --offline -y -p playwright node tests/browser/cashier-next-customer-browser-smoke.js
npx --offline -y -p playwright node tests/browser/cashier-catalog-layout-browser-smoke.js
npm test
git diff --check
```

DB runner requires explicit disposable reset confirmation and its verified test
URL. Initial runs used task-owned `eventgenix-park-dar-followup-test-0eb7`,
loopback port 15439, database `eventgenix_park_dar_test`. Final independent review
proof uses new task-owned `eventgenix-pd3-review-test-0eb7`, loopback-only port 15440,
database `eventgenix_pd3_review_test` and fresh ephemeral app/mock ports; log:
`output/park-dar-pd3-review-postgres.log`. No production URL fallback or live secret.
Synthetic report was moved from generated `outputs/` into ignored `output/`.
After QA only these verified task-owned containers are stopped, without removal.
Correction to the earlier handoff: the canonical runner resets its disposable
public schema in `finally` (`scripts/run-isolated-postgres-tests.js:705`), so fixture
rows do not remain after teardown. The two-cycle history assertions and synthetic
report are captured before cleanup. This explains the missing-table diagnostic
after an earlier run; no external reset or overlapping runner was established.

## Coordinator findings PD3-R1 / PD3-R2

R1 reproduction: the actual application webhook handler with a synthetic local
event committed its queued lookup while the final
close transaction was paused after reading zero blockers. The expected PostgreSQL
advisory wait was absent (`output/park-dar-pd3-r1-before.log`, intentional FAIL).
The handler now resolves the operation, acquires the same physical register lock,
then re-reads and checks exact operation/profile/register scope before audit/enqueue.
It does not apply the stop admission guard to required status recovery. Signature,
authentication, provider configuration and external mutation behavior are unchanged.

The deterministic PG test pauses the actual close/resume final zero-blocker query,
observes the competing webhook backend waiting on an advisory lock through
`pg_stat_activity`, and releases the lifecycle transaction before recovery admission.
PARK resume and DAR close are exercised. Existing pending/failed-job tests cover
blockers already present before lifecycle checks. Each concurrency event selects
a different fiscalized operation without a prior lookup, respecting the existing
per-operation forever-unique lookup constraint. Added lookup jobs explain the total
of 10 rather than 8; no constraint was relaxed or historical job deleted.

R2 reproduction: deactivating the disposable actor during a mock provider GET did
not prevent resume (`output/park-dar-pd3-r2-before.log`, intentional FAIL). Every
authorized scope transaction now uses canonical `loadAuthenticatedUserAccess`
with `requireFresh`, transaction-local `db` and `lockUser`, after the physical lock.
The user row stays locked through the final write. Existing owner/capability/business
checks consume that refreshed actor. Shared auth, sessions and permission registry
code were not edited. Delayed provider-read regressions revoke actor activation,
the close capability or DAR business access; each must deny resume, retain CLOSED
stop and issue zero provider mutations. Fixture access is restored in `finally`.

Final correction evidence is included in `output/park-dar-pd3-postgres.log`, the
synthetic DB report and the refreshed targeted/full-suite logs. The earlier
`48916540...` 29-file review bundle is superseded by the current 31-file manifest.

Independent DB proof initially failed because the test drain helper treated an
empty worker claim as completion despite one remaining queued job. That failure
is retained in `output/park-dar-pd3-review-before-queue-wait.log`. The helper now
waits up to five seconds for queued work after close and reports sanitized job
diagnostics on failure. A transient empty claim is permitted by SKIP LOCKED;
the specific lock/timing cause of that single empty claim was not established.
No worker, backoff, job state or provider behavior was changed. The final independent
run PASS proves actual zero unresolved work, rather than equating claimed=0 with
queue completion. Failed/unknown work is not automatically retried by this wait.

## Remaining limits and rollback

No production migration, exact-SHA CI, deployment or live fiscal/device acceptance
was performed. The design checklist is broader than individual executed fixtures:
fresh coordinated-base review still covers route/binding changes during network
I/O and mixed-version rollout. R1 webhook admission and R2 current actor access
are now explicit local regressions, not deferred review items. Unit tests exercise evidence
expiry, while an actual 30-second lock-wait/provider race is not claimed.

Canonical single-tab auth passes. The PD1 two-tab test isolates auth synthetically;
repeat combined canonical-auth/payment two-tab acceptance after R7B integration.
Native browser zoom 125/150 remains unverified; reduced viewports are separate
layout evidence. Cached provider token expiry intentionally prevents stop/resume
GET verification until existing provider access is refreshed through the separately
authorized ordinary workflow. A provider portal remains outside the local DB lock.

Keep migration/history and active gates on rollback. Pre-drain code cannot safely
run with acceptance enabled alongside active stops. A drain-aware rollback build
is a release prerequisite; otherwise require a separately authorized operational
acceptance-off plan. Never drop history, clear stops or flip flags automatically.

## Concrete next release checkpoint

`PARK-DAR-REUSABLE-TEST-DAY-RELEASE-PREP`:

1. Coordinator verifies this task's patch/base/file hashes and reviews local
   lifecycle/DDL/writer lock ordering. Refresh production/R7B branch and live
   metadata; old 18:36 UTC observations are not current release proof.
2. Recheck migration 352 availability. On the approved coordinated integration
   base preserve R7B auth/session fixes and PD1–PD3, rerun repeat-day DB/browser
   checks and canonical-auth two-tab acceptance. Any migration renumbering must
   update its tests and bundle; do not apply the old candidate blindly.
3. Obtain explicit bounded integration/commit permission, record the resulting
   exact 40-character source SHA and a reviewed drain-aware rollback SHA. Prepare
   intentional version/cache markers only at that release stage.
4. Prepare a separate Yellow production envelope for
   `fortunate-appreciation / production / 8223324090`, branch
   `codex/eventgenix-production`: scoped push, exact-SHA CI, additive migration,
   documented `npm run release:railway-up`, read-only version/health/UI QA; maximum
   one release attempt and six hours. Require existing production acceptance OFF
   and no active legacy worker/shift blocker before an incompatible mixed rollout;
   stop for separate authorization if achieving that would require a settings or
   real-data change. This report neither authorizes nor executes those stages.
5. Real Checkbox login/shift/receipt QA needs its own exact Shared Test owner,
   register, route, catalog/amount and attempt envelope. No production acceptance,
   secrets, rights or real operational data change is implied by release preparation.

Recommended next action: coordinator review of the completed local bundle.
