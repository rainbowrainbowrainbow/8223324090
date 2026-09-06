# PARK/DAR reusable test day — release preparation

Production impact: no. This is a local release candidate and a delivery proposal,
not delivery authorization or live fiscal acceptance.

## Source and ownership

- Accepted PD1–PD3 source: `codex/park-dar-cashier-followup-20260905`, historical
  base `9ea61f1ea6c38b6f218bbc4b9ceda3f772bedbd5`. The original 31-source-file,
  91-source/evidence-hash freeze remains unchanged. Its accepted patch SHA-256 is
  `51122f464c9bf8079f3922d8a0fb7be36c4136f9d2ae68f0ef93535f4e7908c2`.
- Coordinator accepted the corrected R1/R2 package in
  `C:/Users/Plotva/Documents/Codex/2026-09-05/park-dar-followup-supervision/outputs/PARK-DAR-REVIEW.md`.
- Candidate: `output/release-prep/integration`, branch
  `codex/park-dar-release-prep-20260906`, based on
  `d7aed2573d876c7051e96897a835343ed33573d5`. HEAD remains that base; no commit exists.
- The canonical remote and live metadata were independently read on September 6
  local time. Exact timestamp, SHA, version, health and final freshness observation
  are recorded in the external release-prep manifest. The historical 9ea61f1e
  observation is not treated as current live evidence.
- Redirect task owner confirmed the production release at d7aed2573 and no active
  delivery. R9/R10A remains an unaccepted parallel review; its dirty files are not
  included. This task owns only its isolated candidate/recovery worktrees. No other
  task or process was stopped. A later redirect release invalidates this base and
  requires a refreshed candidate before delivery.

## Integration decision and exact boundaries

PD1 next-customer/retry durability, PD2 catalogue layout and PD3 reusable lifecycle
are retained. Both Shared Test routes still refer to one physical register. The
only import conflicts were the package unit-test list and generated version lines
in `IMPLEMENTATION_STATUS.md`; all R7 tests and current baseline markers were kept.
Shared `js/api.js`, `js/auth.js` and `middleware/auth.js` remain byte-identical to
the confirmed production base. No semantic auth or permission conflict was resolved
by changing those contracts. Production fiscal configuration, protected manifests,
secrets, permissions, flags and deployment configuration were not edited.

The new migration remains `352_shared_test_payment_drains.sql`: 352 is available
on the confirmed base, and the migration is byte-identical to the accepted freeze.
It adds historical drain state, exact shift ownership constraints, one active drain
per register and immutable audit guards. Reapplication during an active stop and
both complete test-day histories are exercised on disposable PostgreSQL. No
production schema or migration inventory has been changed or assumed current.

Candidate version is **0.81.77 / PARK/DAR Reusable Test Day**. Canonical version-sync
prepared cache markers, visible release history and lockfile root version metadata;
dependency versions are unchanged. The external bundle separates the functional
patch, version/cache patch, migration patch and complete candidate patch. Files
outside the accepted source list are limited to the new canonical browser test,
release-prep report and intentional generated version/history surfaces.

## Executed evidence and limits

| Check | Result and scope |
| --- | --- |
| Accepted source freeze | All 91 hashes, 31 source files, patch hash and reverse apply verified |
| Targeted regressions | 154/154 PASS on Node 22.23.1 / npm 10.9.8 |
| Candidate `npm test` | PASS, including 2545 unit tests, migration/governance/protected-surface checks and UI 1310/1310 |
| Canonical-auth actual app | PASS on actual HTTP app and disposable PG: real assets/login/session/permissions; two tabs, response lost after DB acceptance, reload, stable key, one order, next customer, stale-tab protection, pending queue retained |
| Repeat-day integration | PASS: PARK then DAR, 4 sale receipts, 10 jobs, 2 CLOSED shifts, zero queued/failed/dead/unknown work at proof completion |
| Concurrent new payment | Observed real PostgreSQL advisory wait behind an uncommitted stop; after commit the payment is denied and order count is unchanged |
| Webhook and actor access | Actual webhook waits behind final close/resume blocker check; required recovery lookup remains admitted. Actor deactivation, close capability and DAR access revoked during mock provider IO are freshly rejected |
| History/global OFF | Old resume A cannot clear active stop B; migration reapply preserves active stop/history; resume while global acceptance OFF leaves it OFF |
| Layout/lifecycle UI | 16/16 layout cases; lifecycle cancel/lost-response/reload/stable resume key PASS; representative screenshots inspected |

Canonical browser execution uses `RUN_PARK_DAR_CANONICAL_BROWSER=true` with the
existing isolated runner. It does not substitute auth responses or page globals.
The only payment interception forwards the real request and deliberately loses its
first real response. External browser requests are blocked; all Checkbox calls
use the loopback mock. Fixture credentials remain local and are not evidence.
The synthetic-auth browser smoke is separate evidence and is not the canonical
two-tab proof.

The first canonical run correctly blocked a new draft while the shift was OPENING.
The fixture now waits for the normal worker to open the shift and refreshes normal
readiness before the next sale while keeping the accepted receipt unresolved.
Rollback fixture failures exposed an empty worker claim and a stale readiness
snapshot; retained failure logs show these distinctly. The existing bounded queued
wait is now used after opening as well as closing; no job state, retry/backoff or
provider production code was changed. The specific empty-claim timing cause was
not established. Recovery release-history continuity was corrected before its
final full test. Final logs and result summaries in the manifest govern PASS.

Disposable runner teardown resets its own public schema. Receipt/history proof is
captured before teardown; absence of tables afterwards is not a history failure.
Only the task-owned container `eventgenix-park-dar-prep-test-0eb7`, loopback port
15441 / DB `eventgenix_park_dar_prep_test`, is used for these new proofs.

Unexecuted: exact-SHA CI, deployment, production migration inventory, real Checkbox
login/shift/receipt/device behavior, owner browser native zoom 125%/150%, actual
30-second evidence-expiry lock race, and mixed-version production cutover. Local
tests do not prove live readiness. Viewport screenshots do not prove native zoom.

## Drain-aware rollback source and rollout order

### Provider-call hold is a mandatory preflight gate

The prior local code/test acceptance remains valid. The earlier READY FOR OWNER
DELIVERY DECISION status is withdrawn: **delivery is blocked while durable,
effective provider-call hold is unproven**. Global payment acceptance OFF and an
empty queue do not establish that hold. This clarification changes only the
proposal/evidence; no product guard, setting or production state was changed.

This gate applies only to release-controlled EventGenix instances, workers and API
paths in `fortunate-appreciation / production / 8223324090`: the old and new
versions participating in **this DELIVERY-1 cutover**. It excludes hypothetical
scripts, test-only injected provider overrides, unrelated services and the owner's
OLD CRM. **OLD CRM must continue operating unchanged.** The prepared recovery
build is not deployed by DELIVERY-1; its hold must be revalidated only if a later,
separately authorized recovery delivery is requested.

Source inspection identifies these existing guards and their limits:

- `server.js` schedules readiness every 60 seconds and outbox every 30 seconds.
  `runCheckboxReadinessProbeSchedulerOnce` skips for integration OFF, but otherwise
  supplies `paymentAcceptanceEnabled: true`, can probe the provider, persist
  readiness/reconciliation state and wake recovery work. Acceptance OFF does not
  suppress those provider calls or associated operational writes.
- `scheduler_executions.is_paused` is persisted and `guardScheduler` reads it before
  each scheduled invocation, including when `autoPause: false`. It does not stop
  an already-running invocation, a direct service call, HTTP request or post-commit
  wakeup. A completing invocation records success with `is_paused=false`; an
  observed pause row alone is insufficient proof of a stable hold.
- `BACKUP_OUTBOUND_HOLD` returns before startup background registration, while HTTP
  remains available. It is read at process startup and is not a universal check
  in the provider client or payment services. Its log/backup catalog boolean is
  not proof that every provider entry point is suppressed. Setting it now would
  also affect unrelated background work and is outside this delivery scope.
- `PAYMENT_OUTBOX_WAKEUP_DISABLED` gates post-commit immediate wakeups, separately
  from the scheduled worker. It does not cancel an already-running worker or gate
  direct provider reads. Integration OFF is checked by the normal worker factory,
  readiness and Shared Test evidence paths. Existing
  `CHECKBOX_INTEGRATION_ENABLED=false` **may establish the required predicate**
  when exact code/configuration/instance/startup/in-flight evidence covers the
  actual EventGenix paths in this cutover. A universal client or network/egress
  block is not required because unit tests can inject a provider. Those test-only
  overrides and hypothetical direct scripts do not expand this delivery scope.
- Ordinary cashier initial load/polling calls local GET state readers. Explicit
  readiness refresh and candidate next-customer safety refresh POST to the probe;
  close/stop/resume also read provider state. Recovery's older UI does not remove
  the backend entry points. QA must not trigger these paths. A cashier process
  pause or an operator promise not to click is not a durable technical hold.

Before any delivery write stage, require a dated, sanitized **read-only** evidence
record identifying an already-existing effective hold, its authoritative persisted
source, and its observed runtime enforcement. It must cover the release-controlled
old and candidate EventGenix instances/workers participating in this cutover,
startup/restarts/rolling overlap, scheduled readiness, scheduled and immediate
outbox, actual EventGenix API/UI provider paths, and their already-dispatched/
in-flight work. Prove that it survives the
release helper's restart and that no running invocation can clear or bypass it.
Evidence must establish prevention of real provider reads, authentication and
mutations, not merely absence of recent traffic, an empty queue or a single UI
flag. Do not test the hold by attempting a real Checkbox call. Read-only proof of
the normal-runtime integration-OFF gate may suffice; no new universal network
control is requested or required. Creating or changing a control is not authorized.

No production scheduler rows, flags, settings, provider or process state were
queried for this clarification. The hold is therefore **UNPROVEN**, not PASS.
The required predicate is a conjunction, with every term supported by that
read-only record: for each release-controlled old/new EventGenix instance or worker
active or started as part of this DELIVERY-1 cutover, the named existing guard is
persisted, effective at startup and now, covers its actual production runtime/API
provider entry points, has zero in-flight provider calls, cannot be
cleared by completion of an earlier run, and remains effective across restart and
cutover. Every term must be TRUE; UNKNOWN is failure. A short observation window
without traffic does not establish this predicate.
If absent, stale, incomplete or not provably effective across the cutover,
**DELIVERY-1 must stop before commit/push/deploy**. Do not set or unpause scheduler
rows, change integration/acceptance/wakeup/backup flags, add egress rules, terminate
workers, clear queues, or run provider probes as an implied repair. Such changes
need a separate exact scope; this block grants none. The EventGenix hold must remain
effective through this cutover and read-only post-deploy QA. Recovery hold evidence
is revalidated under a later recovery authorization, not required for deploying
an unused recovery build now. OLD CRM and unrelated services must not be paused.

A distinct prepared recovery worktree is at
`output/release-prep/drain-aware-rollback`, branch
`codex/park-dar-drain-aware-rollback-20260906`, same d7aed base. Its planned version
is **0.81.78 / PARK/DAR Drain-aware Recovery**, conditional on recovering 0.81.77.
It restores the R7 cashier UI and retains all **nine** candidate runtime/schema
files byte-for-byte, including physical admission locks, stop/resume endpoints,
readiness/close gates, worker-compatible recovery and R1/R2 fixes. Its exact patch,
file hashes, runtime equality and independent local PG/full-suite results are in
the external manifest. The recovery version is not reserved against future work.
Its legacy UI lacks the new next-day controls; exact existing-owner recovery API
operations would require their own operational permission. It remains safe to
leave an existing stop active. It is not a rollback for defects in the retained
backend itself; those require a separately reviewed scoped fix.

Never redeploy bare d7aed or 9ea61f1e while a lifecycle is active: their old writers
do not enforce the local stop. Never drop 352, clear a stop, erase history, enable
acceptance or repair real fiscal records automatically. The recovery is a forward
compatibility deployment with fresh assets, not a database downgrade or force push.
No recovery deployment is authorized by this preparation or the delivery proposal.

The future release must follow this order:

1. Refresh live/canonical SHA and parallel release ownership. First satisfy the
   durable provider-call hold gate above using read-only evidence; absent or
   unproven hold stops the entire block before any write stage. Additionally,
   preflight must verify global acceptance is already OFF, the actual migration inventory
   has no unapproved pending changes, and there are no active legacy fiscal shifts,
   unresolved receipts or jobs that could run under incompatible old code. Missing
   evidence or any failed precondition stops delivery; changing flags, draining
   real work or changing settings needs a separate precise operational scope.
2. Coordinate a short cashier/release-process pause. Do not pause unrelated CRM
   work or stop another task's processes. Keep new cashier lifecycle operations
   unused during overlap of old and new instances/workers.
3. Deliver the reviewed exact SHA only after green exact-SHA CI. The documented
   helper starts the app through `initDatabase -> runMigrations -> initDatabase`.
   Permit only additive 352; verify all earlier migrations are already applied.
   Do not execute a separate blanket migration command. DDL may briefly wait for
   existing DB locks; no unsafe forced unlock or long-transaction termination.
4. Verify migration 352 and exact SHA/version/branch read-only, then verify all old
   instances/workers have left the release cutover before ending the cashier pause.
   Keep global acceptance OFF and retain the proven provider-call hold. Safe UI QA
   uses only verified local/static read paths; no readiness probe,
   provider login, stop/resume/close, payment or receipt action is included.
5. If recovery is required, retain schema/history and choose the hashed drain-aware
   recovery source. Refresh its base/version, revalidate its EventGenix hold for
   that later cutover under a bounded recovery delivery
   authorization, commit/CI/deploy its exact SHA and apply no down migration.
   Mixed candidate/recovery instances have the identical nine safety files.

## One proposed delivery checkpoint — not authorized

**PARK-DAR-REUSABLE-TEST-DAY-DELIVERY-1**: one attempt, at most six hours from separate
explicit authorization; project `fortunate-appreciation`
(`bc28b46c-d4bc-491c-893a-d8401c633668`), environment `production`, service
`8223324090`, canonical branch `codex/eventgenix-production`.

Status: **BLOCKED — durable effective provider-call hold unproven**. Separate owner
authorization would not waive this mandatory read-only gate or authorize creating
the hold. Only a verified existing hold allows progression to the write stages.

Authorize only the exact candidate file list and hashes in the reviewed prep
manifest: scoped local functional/version commits (plus a local recovery reference
commit), fast-forward push of the candidate to the freshly confirmed canonical
branch, green exact-SHA CI, `npm run release:railway-up` with documented
`RELEASE_DEPLOY_BRANCH=codex/eventgenix-production`, startup application of **only
352**, and read-only exact SHA/version/migration-state/safe UI QA. Preserve R7 and
all newer confirmed changes; any source/hash/base/version/migration drift stops the
block for refreshed review. Do not push the recovery branch or deploy recovery
under this block. Record the real 40-character candidate and recovery SHAs only
after those explicitly authorized commits; this report invents none.

Excluded: production fiscal operations, real Checkbox calls/logins, operational
data fixes, acceptance/secrets/rights/settings changes, native owner zoom claims,
additional migrations, force push, destructive rollback and additional attempts.
Real test shifts/receipts require a separate exact owner/register/routes/items/
amounts/attempt envelope. No commit, push, deploy or production mutation has been
performed under either the original LOCAL block or this preparation.

Recommended next action: coordinator review of this clarified immutable proposal;
delivery stays blocked until the existing effective provider-call hold is proven
read-only under a separately bounded instruction. This document grants no permission.
