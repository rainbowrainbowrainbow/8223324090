# Shared Test stop/resume: protected review proposal

Date: 2026-09-05. Status: IMPLEMENTED LOCALLY under owner authorization
`PARK-DAR-REUSABLE-TEST-DAY-LOCAL`. Production impact: no for this local task.
Baseline: `9ea61f1ea6c38b6f218bbc4b9ceda3f772bedbd5`.

Implementation and actual evidence: `REUSABLE_TEST_DAY_LOCAL_ACCEPTANCE_20260905.md`.
This accepted design remains the contract; illustrative SQL below is not the
executable migration. Canonical DDL is `db/migrations/352_shared_test_payment_drains.sql`.

## Product scope and current boundary

The owner needs repeatable test days on one physical Shared Test register, with
PARK and DAR used sequentially. The selected design retains one historical drain
per closed shift and explicitly resumes that drain after closure verification.
It replaces the earlier terminal, primary-key-per-register proposal. The reusable
design is implemented and applied only to the task-owned disposable PostgreSQL.

The baseline close required global Checkbox acceptance OFF. Both current preflight
and authoritative close transactions now also accept an exact owner/scope-verified
active Shared Test drain. All other close guards remain. The owner explicitly
authorized this local server-rule change, schema, endpoints, UI and disposable tests;
this document grants no production or security-setting permission.

Retain exact `integration_owner`, `fiscal.shift.close`, business/route access,
actual shift opener's active fiscal binding, fresh exact provider identity and
`is_test=true`, physical register locking, register-wide blockers, unique durable
close/outbox UUID and lookup-only recovery. Retain all global/integration/route/
register/identity acceptance gates, real-register behavior and Cashier PRO.

## Exact historical schema design

One additive schema migration, local number 352 (recheck upstream before integration). No
seed, backfill, grants, permission changes, environment settings or history edits.
`users.id` is SERIAL/INTEGER (migration 001 and `db/index.js`); fiscal profile,
register and shift IDs are BIGSERIAL/BIGINT (316). No subsequent type change was
found. The existing shift-to-register/profile FK in 316 proves physical ownership;
add a unique shift triple to support the chosen composite drain FK. Route keys
are VARCHAR(64), not numeric IDs (351).

The following is review SQL, not a complete idempotent startup migration. Future
DDL must use the repository catalog-check pattern for named constraints/indexes.

```sql
-- MIGRATION_KIND: schema
-- SAFETY: Add empty historical test-drain state; no existing data changes.
-- ROLLBACK: Retain all history and active gates; use drain-aware compatibility code.
ALTER TABLE fiscal_shifts
    ADD CONSTRAINT uq_fiscal_shifts_id_profile_register_drain
    UNIQUE (id, fiscal_profile_id, fiscal_register_id);

CREATE TABLE fiscal_register_payment_drains (
    id BIGSERIAL PRIMARY KEY,
    fiscal_profile_id BIGINT NOT NULL,
    fiscal_register_id BIGINT NOT NULL,
    fiscal_shift_id BIGINT NOT NULL UNIQUE,
    initiating_route_option_id VARCHAR(64) NOT NULL
        REFERENCES fiscal_sale_routes(route_option_id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
    scope_fingerprint CHAR(64) NOT NULL
        CHECK (scope_fingerprint ~ '^[0-9a-f]{64}$'),
    initiated_by_user_id INTEGER NOT NULL REFERENCES users(id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
    drain_idempotency_key VARCHAR(255) NOT NULL UNIQUE
        CHECK (drain_idempotency_key LIKE 'drain:%'),
    status VARCHAR(16) NOT NULL
        CHECK (status IN ('draining', 'closed', 'resumed')),
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    closed_at TIMESTAMPTZ,
    resumed_at TIMESTAMPTZ,
    resumed_by_user_id INTEGER REFERENCES users(id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
    resume_idempotency_key VARCHAR(255) UNIQUE
        CHECK (resume_idempotency_key LIKE 'resume:%'),
    CHECK (
        (status = 'draining' AND closed_at IS NULL)
        OR (status IN ('closed', 'resumed') AND closed_at IS NOT NULL)
    ),
    CHECK (
        (status = 'resumed' AND resumed_at IS NOT NULL
         AND resumed_by_user_id IS NOT NULL AND resume_idempotency_key IS NOT NULL)
        OR (status <> 'resumed' AND resumed_at IS NULL
            AND resumed_by_user_id IS NULL AND resume_idempotency_key IS NULL)
    ),
    CHECK (closed_at IS NULL OR closed_at >= started_at),
    CHECK (resumed_at IS NULL OR resumed_at >= closed_at),
    CHECK (resumed_by_user_id IS NULL
           OR resumed_by_user_id = initiated_by_user_id),
    CONSTRAINT fk_payment_drains_exact_shift
        FOREIGN KEY (fiscal_shift_id, fiscal_profile_id, fiscal_register_id)
        REFERENCES fiscal_shifts(id, fiscal_profile_id, fiscal_register_id)
        ON UPDATE RESTRICT ON DELETE RESTRICT NOT DEFERRABLE
);

CREATE UNIQUE INDEX uq_payment_drains_one_active_register
    ON fiscal_register_payment_drains (fiscal_register_id)
    WHERE status IN ('draining', 'closed');
```

The composite FK is the one chosen register/shift relationship mechanism. The
partial unique index allows at most one active stop per globally unique physical
register, while resumed rows remain permanently queryable. Shift uniqueness means
an old shift cannot receive a new cycle. A different later shift receives a new
row/ID after the previous drain is resumed. Retain migration 343's unresolved-shift
uniqueness and forever unique open/close operation per profile/shift, and migration
331's operation identity constraints. A new key never replaces a close operation.

A single `BEFORE INSERT OR UPDATE OR DELETE` lifecycle trigger is also proposed:
insert only `draining`; reject DELETE; freeze ID, profile/register/shift, initiating
route, fingerprint, initiator, drain key and started_at. Allow only unchanged replay,
`draining -> closed` setting closed_at once, and `closed -> resumed` setting all
three resume fields once. Preserve closed_at on resume. A resumed row is immutable;
there is no backward transition or in-place reuse. This trigger governs lifecycle,
not the composite FK. Each successful transition writes an existing append-only
fiscal audit event atomically with its row change, including actor, cycle ID and
sanitized verification outcome. Never store credentials or tokens in these rows.

`scope_fingerprint` is server-computed SHA-256 of canonical identity fields: both
route keys/business contexts, physical profile/location/register IDs, shared group,
expected test identity, provider organization/outlet/register and exact shift IDs,
and the opener's binding/user identity. These are read from trusted canonical
sources, never the body. Acceptance flags are not identity: resume does not change
or override them. Mutable permission/binding activity is reauthorized, not assumed
from this historical fingerprint. A mapping/identity change blocks mutation for
separate review; it does not rewrite historical scope or transfer ownership.

The extra shift unique index/constraint takes a DB lock and builds an index on
existing rows. Assess its production lock duration only before separate migration
approval. No migration is scheduled by this proposal.

## State and product behavior

| Transition | Required condition | Effect |
| --- | --- | --- |
| No active stop -> draining | Explicit owner stop on the current exact OPENED test shift | Atomically block new drafts, unpaid confirmations and new shift opening for both routes. |
| draining -> closed | Canonical close has verified this exact provider shift CLOSED, with durable operation recovery retained | Keep the physical stop active. |
| closed -> resumed | Explicit owner confirmation, fresh exact CLOSED and identity evidence, register-wide blockers/unknowns zero, no unresolved/open/newer shift, current authority and unchanged scope | Remove only this row's local drain prohibition; retain its complete history. |
| resumed -> new draining row | A later shift has opened through the normal gated sale/open flow, then owner explicitly stops that exact shift | Create the next cycle; do not reuse the earlier row. |

Midnight, a business-date change, reload or process restart never resumes anything.
The UI confirmation is “Почати наступний тестовий день” and must explain that it
only removes the local stop. Resume creates no shift, receipt, order or provider
mutation; it does not log in a provider, alter global/env/register/route acceptance,
or turn on disabled features. Fresh provider reads use the existing authorized
read path; unavailable/expired provider access leaves the stop in place.

Sale availability remains `all existing sale gates AND no active local drain`.
In particular, global acceptance=false means sales remain disabled after a
successful resume. The response returns both the historical resume outcome and
fresh current availability/block reasons, so “resumed” is never advertised as
“shift opened” or “sales enabled”. Ordinary draft creation after resume and the
first later confirmation/shift opening still follow every existing server gate.

Existing unpaid drafts are retained throughout. After resume they may be confirmed
only through their original route/owner authorization, existing immutable order
contract, and current ordinary eligibility checks. Resume neither reassigns them
nor recalculates/cancels/deletes them. Accepted pending work before drain retains
its UUID and resolves against the existing exact shift; requiring a new shift
while stopped is intervention, not a bypass. Any unresolved accepted work blocks
close/resume even if it originated on the other route or an older shift.

## Endpoints and exact authorization

| Endpoint / area | Proposed contract |
| --- | --- |
| `POST /api/payments/shifts/:shiftId/phase1-drain` | Empty body, required nonempty Idempotency-Key. Explicit confirmation of stopping both routes. Server derives physical scope from exact shift and approved route header. Insert draining row and audit, or return an authorized historical replay. |
| Existing Phase-1 close endpoint | Preserve exact close confirmation and durable close operation. Accept current global OFF policy or an active exact Shared Test drain plus all existing close safeguards. Verify in preflight and the authoritative transaction; never let a resumed historical row satisfy the alternative gate. |
| `POST /api/payments/test-drains/:drainId/resume` | Required Idempotency-Key and exact body `{ "confirmNextTestDay": true }`; reject false/missing/extra identity fields. The ID selects one historical row. Recheck all resume conditions below before closed -> resumed; no shift-open or provider-write call is permitted in this handler. |
| Readiness | Expose sanitized `sharedTestDay.activeDrain`, `localDrainBlocked`, `canDrain`, `canResume` and reason codes; action responses include the selected historical `drain`. Server predicates are authoritative. Missing/unavailable DB state fails closed. |
| Catalog/admission draft creation and `confirmPaymentOrder()` | Check the active-stop predicate under physical lock before authoritative new writes; preserve existing confirmed/idempotent replay. An active stop returns `409 shared_test_register_draining`. |
| `ensureOpenShiftForSale()` and other shift-open entries | Same physical lock and active-stop check plus current shift uniqueness and every existing open gate. A historical resumed drain is neither an open command nor an admission token. |
| Cashier UI | Owner confirms stop, watches register-wide recovery, explicitly closes exact shift, then may separately confirm next test day after CLOSED. Do not auto-chain close and resume. |

Both new mutation endpoints require existing `fiscal.shift.close` middleware and
exact current `integration_owner`. Additionally authorize BOTH PARK/event_genix
and DAR/dar logical scopes, not merely access to the displayed route. Require
exactly `park_test` and `dar_test` on the same physical register, mode=test,
expected_is_test=true and one matching nonempty shared group; any extra route,
wrong business, production mode or mismatched mapping fails closed. The request
route must belong to that pair and match the shift's original logical ownership.
Resume must use the drain's initiating route and SAME initiating owner user with
current authority. Revalidate the actual opener's active binding/capability through
the canonical close authorization path even though the shift is now closed.
A different cashier/owner/route cannot resume it; ownership transfer is outside
this scope. These explicit endpoint mappings require executable permission-contract
review at the coordinated release checkpoint. Local action/permission contract
checks passed; no ordinary-cashier rights were granted.

## Authoritative resume conditions

1. The requested row is the active `closed` drain for this register, not an old
   resumed ID. Its stored shift is locally closed with lifecycle CLOSED and exact
   durable provider identity. The canonical close operation is terminal successful.
2. Obtain new uncached provider identity, exact shift detail CLOSED and current
   register-shift observation: no OPENING/OPENED/CLOSING or different current shift.
   Require positive `is_test=true`; unknown/null/missing/stale/mismatched observations
   fail closed. For this design evidence expires after 30 seconds before commit;
   do not extend that deadline when waiting for a lock.
3. Under the physical lock, repeat DB authorization, fingerprint/mapping checks,
   exact closed/operation state, active drain identity and register-wide
   `countFiscalShiftCloseBlockers() === 0`. That helper includes confirmed
   unfiscalized orders, unresolved refunds, pending/failed/unknown operations and
   queued/running/failed/dead jobs, including conservative orphan-job blockers.
   Require separately no local unresolved shift or later shift on the register;
   never exclude other-route, previous-shift or unknown work from the zero check.
4. Commit only if all conditions still hold. Provider evidence and local/config
   identity read before/after the network phase must agree; otherwise retry with
   fresh evidence without changing the stop. Write resumed fields and audit in one
   transaction. There is no intermediate unblocked state.

Provider reads are point-in-time evidence, not a lock on an external provider UI.
If an independent provider action is detected, fail closed and require review.
The subsequent ordinary shift/sale paths must still obtain fresh existing provider
readiness; resume cannot guarantee the absence of later out-of-band provider work.

## Locks, concurrency and idempotency

- Drain, resume, close, new draft admission, confirmation and all shift-open/start
  paths use the SAME existing two-argument
  `pg_advisory_xact_lock(profileId, registerId)` domain. Persisted IDs are BIGINT,
  but that API is INTEGER/INTEGER: validate exact signed-32-bit integer IDs and
  fail closed out of range, never hash/truncate/change just one path's lock domain.
- Keep catalog creation's existing request-key lock first, then physical lock
  before fresh reads/inserts. Lifecycle actions take physical lock, then row
  `FOR UPDATE`; they do not take per-order/request-key locks while holding it.
  All new fiscal-job admission that could invalidate zero blockers must honor this
  physical lock; worker completion may only reduce blockers or retain existing
  recoverable work. Audit these writer paths during local implementation review.
- Provider HTTP runs outside DB transactions. Resume's final transaction reacquires
  the same lock and rechecks everything above, including freshness. New drafts and
  shift opening stay blocked throughout the network phase because closed remains
  active. Concurrent resume/drain/start actions serialize at the physical register,
  across both routes/devices. After lock wait a loser must re-read and either replay
  its exact action or fail; a pre-lock observation never admits a write.
- Drain inserts only for the exact current OPENED shift. While an active row exists,
  a different shift returns `409 shared_test_drain_shift_conflict`. After resume,
  a stale drain request for the earlier shift returns its historical result and
  cannot re-stop the register. A new cycle requires a later exact OPENED shift.
- Normalize keys server-side to `drain:<sha256(header)>` or
  `resume:<sha256(header)>`. Action prefixes make the two unique key spaces
  disjoint. Bind each stored key to actor, route and exact shift/drain ID. Same
  action/key with different scope returns `409 shared_test_idempotency_conflict`.
  Check key conflicts BEFORE treating another key as same-target replay.
- Same authorized drain/shift with a different key returns the existing row
  without replacing its key. Same owner/route resume retry of an already resumed
  row returns that immutable historical success without another transition/audit,
  even if a later cycle exists. It must also return current active-drain/availability
  state: a retry for cycle A can NEVER resume cycle B. A different key on the same
  already resumed target is the same harmless historical replay.
- Historical replay still requires current authenticated scope/owner authorization;
  it need not perform provider reads because it changes nothing. A first resume
  from draining fails `409 shared_test_drain_not_closed`; blockers or uncertain
  evidence return explicit conflict/unavailable reasons and keep the row active.
  Wrong owner/capability/route returns access denial without revealing foreign data.
- A timed-out close recovers the SAME durable UUID; a timed-out resume retries the
  SAME drain ID/key. Crash before commit leaves closed active; crash after commit
  yields historical replay. No replacement close POST, automatic resume or history
  deletion. Existing unique shift constraints ensure one later shift when PARK/DAR
  start sequentially; a losing concurrent start rechecks existing ownership and
  must not silently attach an order through the other route.

## Required local proof before release review

The matrix below is the design's review checklist. Executed cases and remaining
integration/device limits are distinguished in `REUSABLE_TEST_DAY_LOCAL_ACCEPTANCE_20260905.md`:

- Two complete days: PARK then DAR sequential usage, explicit drain/close/resume,
  later normal gated shift creation, second drain with a different ID/shift, both
  historical rows retained and at most one active stop.
- CLOSED with queue zero stays stopped across midnight/reload/restart until explicit
  same-owner confirmation; resume sends no provider mutation, shift-open, receipt,
  flag/config update or order edit. With global acceptance OFF, resume succeeds if
  its own conditions hold but both routes remain unable to create/confirm sales.
- Existing unpaid drafts retained and ordinary authorization reapplied after resume;
  already-confirmed idempotent replay and pending/unknown UUID recovery unchanged.
- Concurrent PARK/DAR create/confirm/start/drain/resume, both tabs and devices,
  resume vs new blocker admission, expired evidence after lock wait, stale route or
  binding changes between network reads and commit; never two active stops/shifts.
- Same/different key replay, key collision across scopes, lost response before/after
  commit, cycle A resume retry while cycle B is actively stopped, and stale drain
  of shift A; no release of B, no duplicate audit/close/provider POST.
- Wrong owner, lost rights, other route, inactive opener binding, extra/missing
  route, changed shared group, production register, `is_test=false/null`, identity
  mismatch, provider unavailable/stale CLOSED, any current/newer/unresolved shift,
  any register-wide order/refund/operation/job/unknown blocker: stop retained.
- Direct SQL mismatched FK, second active row, duplicate shift, illegal transition,
  identity/key/timestamp rewrite or DELETE rejected; resumed history cannot be
  reused. Out-of-range advisory-lock IDs fail closed.
- Drain-aware rollback preserves both active gates and historical replay; old code
  that lacks the gate cannot run alongside acceptance-enabled new code.

## Rollback and approval boundary

Rollback keeps the additive table/indexes, historical rows and active predicates.
A compatible application must understand draining/closed as active and resumed as
historical, preserve both-route gates, and safely reject unavailable resume actions.
Do not deploy pre-drain code while acceptance is enabled: it does not enforce these
stops. If no compatible rollback exists, block rollback pending a separately
explicitly authorized acceptance-off operational plan; never silently change flags,
drop history, reset lifecycle or re-enable acceptance as rollback. Mixed application
versions that do not enforce the gate are not supported during an active lifecycle.

The owner authorized local implementation and disposable testing of this contract.
Review the resulting exact diff and evidence before release preparation. Production
migration, provider login/mutations, runtime activation, permission changes, commit,
push and deployment remain outside this task. Release approval requires the actual
implemented diff and new passing repeat-day evidence on the coordinated base.
