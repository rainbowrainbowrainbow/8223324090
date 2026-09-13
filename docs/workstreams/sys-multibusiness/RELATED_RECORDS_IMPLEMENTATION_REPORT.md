# SYS-MB-D04 — Related-record integrity

Date: 2026-09-12. Status: **READY_LOCAL_RELATED_RECORDS_REVIEW_WITH_PROTECTED_BLOCKER**.
Independent implementation, PostgreSQL verification and full baseline complete.
Production cutover: **HOLD_LINKEDTO_AND_REMAINING_DOMAIN_GAPS**.

## Checkpoint and isolation

- Worktree: `C:\Users\Plotva\OneDrive\Документи\EventGenix\.worktrees\sys-mb-auth-p0-20260912`.
- Branch: `codex/sys-mb-auth-p0-20260912`.
- HEAD/base: `a5180def01a1e47f8f4fc75e2f7a43092f205828`.
- All **126 source SHA256 entries** in `BUSINESS_CABINET_VERIFICATION.json` matched before D04 edits. Earlier D01–D03 work was preserved. Historical reports/manifests remain evidence of their own checkpoints.
- The work is cumulative and uncommitted. There is no D04 implementation commit to cherry-pick. Local `0.81.132` is an unreleased marker, not the site's version.
- This increment changes no schema/migrations, auth/session/membership policy, dependencies, secrets, formulas/prices, booking identity/field precedence, protected manifest, modal ownership or shared menu/router/theme. Existing prior edits to shared files remain present.
- No commit, push, CI, deploy, live-site QA, production preflight/data operation, credential loading or real provider call was performed. Maysternya changes are local parent-update validation and compatibility preservation; its external mapping, token contract and provider configuration remain unchanged.

## Reproduced defects and implementation

| Finding | Before | D04 behavior |
| --- | --- | --- |
| Supplied/retained foreign references | Direct stage/link/ensure service calls could accept a foreign booking/product/customer, even when an HTTP caller happened to validate it | The service resolves and locks real referenced rows in the same business, including retained references and external-ID conflict results |
| Parent UPDATE affects zero rows | A suppressed lead/customer UPDATE could still report success or allow a link/interaction | Require exactly one affected parent row before success or child writes; return a domain conflict otherwise |
| Caller catches a JavaScript validation error | An outer caller could commit the preceding service writes after catching a later failure | Service savepoints undo the complete failed service operation while preserving the caller's authority over the outer transaction |
| Optional booking handoff suppresses integrity failure | Booking could succeed after a deterministic ownership/parent failure | Such failures propagate through the optional savepoint to the booking's outer rollback |
| Concurrent handoffs for different leads and one customer | The new row-lock path can deadlock; a raw database error could be swallowed as optional failure | A recovered `40P01` becomes explicit **409 `lead_transaction_conflict`**. Whole-transaction rollback and a fresh-transaction retry are verified |

The expanded pre-change direct-service reproducer reported **33 failing scenarios**
(34 runner failures including its parent). This proves local service gaps, not a
live-site exploit. Saved original services and failed logs remain under
`.codex-temp/sys-mb-d04/before/` and `direct-services-before*.log`.

### Service and transaction contract

`services/leadReferenceIntegrity.js` centralizes strict record IDs, normalized
context, whitelisted reference tables/lock modes, checked parent updates and
service savepoints. Undefined legacy context retains Park; malformed explicit
context is rejected. SQL treats a historical NULL context as **Park only**, never
as whichever business the caller requested.

`transitionLeadStage`, `attachLeadBookingLink` and `ensureLeadForBooking` require an
existing transaction client. They do not issue BEGIN or COMMIT. An attempt outside
a transaction fails before service writes. SAVEPOINT cleanup failures propagate;
they cannot be reported as a successful optional handoff. Ordinary operation
errors retain their identity; recovered deadlocks receive the safe domain code.

`leadStageTransition.js` checks supplied/retained booking and retained product
references after the scoped lead lock. This also covers the allowed-from-stage
skip path that updates only the booking reference. Stage rules, timestamps,
statuses and interaction semantics are preserved.

`leadBookingLink.js` validates the stored booking and both incoming/retained
products before reuse/insert; checks retained lead and customer references; and
verifies the row returned by an external-ID upsert. Customer links use an atomic
INSERT SELECT from scoped, locked parents. No child link follows UPDATE=0.

Ownership here means the **record's business partition**, not permission to act as
a user. Fresh membership/role resolution remains the HTTP/background caller's
responsibility. A service cannot infer authorization from an arbitrary supplied
context. No historical records were reassigned or cleaned up.

### Existing Maysternya compatibility preserved

The existing webhook accepts a program name, code or ID and persists
`programId || programCode || 'MD'`. Actual `bookings.program_id` and
`leads.program_id` are VARCHAR fields without product FKs. Migration 209 seeds
only `md_demo_consult_15` and `md_full_consult_40`; it does not create records for
every external provider code. Requiring an actual product for all such legacy
values would break the current name-only/code-only contract.

For **MD only**, the validator first checks whether the supplied value is a real
product ID. A real product must belong to MD; foreign or NULL/Park ownership is
denied. A missing opaque code is retained only when the server registry has no MD
row or explicitly says `access_mode = 'compatibility'`. Membership and unknown
modes reject missing products. Park, Dar and custom contexts remain strict.

This preserves existing metadata, not a new tenant-ownership model. It does not
create products, remap IDs, alter field precedence or enable MD membership.
Product-code collisions and the future external-code → product mapping remain
explicit prerequisites for MD cutover. The tests use schema-faithful VARCHAR
columns without artificial product FKs or invented products for opaque codes.

### HTTP/background callers

- `routes/leads.js`: reference-only PATCH operations now keep their parent/reference checks in one transaction. The existing route-local customer-link helper uses scoped INSERT SELECT, including post-commit/background calls. Named integrity errors preserve their safe status/code.
- `routes/bookings.js`: only the unprotected lead-handoff/optional-step helpers changed in D04. Explicit attachment failure, integrity errors, cleanup failure and deadlock propagate to the canonical outer rollback. Genuine unrelated optional infrastructure failures retain their prior behavior.
- `services/maysternyaBookingWebhook.js`: a customer attachment UPDATE=0 fails before lead handoff, allowing the existing outer transaction to roll back its work. No provider was invoked.

## Incremental files

| Area | Files |
| --- | --- |
| Service implementation | `services/leadReferenceIntegrity.js` (new), `services/leadStageTransition.js`, `services/leadBookingLink.js` |
| Caller integration | `routes/leads.js`, `routes/bookings.js` (unprotected helpers only), `services/maysternyaBookingWebhook.js` |
| Regression tests | `tests/lead-reference-integrity.test.js`, `tests/lead-related-records-callers.test.js` (new); `tests/lead-booking-link.test.js`, `tests/booking-create-durability.test.js`, `tests/route-smoke.test.js` |
| PostgreSQL tests | `tests/integration/lead-related-records-postgres.test.js`, `tests/integration/booking-linkedto-reproducer-postgres.test.js` (new); `tests/integration/customer-lead-business-isolation-postgres.test.js` |
| Verification wiring | `package.json`: adds only the D04 `test:unit:lead-integrity` stage to the existing cumulative baseline; no version/dependency/lockfile change |
| Documentation | This report, `RELATED_RECORDS_VERIFICATION.json`, `LINKEDTO_PROTECTED_SCOPE.md`, continuation/inventory updates |

The new unit stage avoids extending an already near-limit Windows command line.
Exact cumulative and incremental file lists/hashes are in the new manifest.
`git diff HEAD` includes prior work; do not label every dirty file a D04 change.

## Verification

| Check | Result | Evidence / limits |
| --- | --- | --- |
| Full `npm test` | **PASS**, exit 0 | `npm-test-final.log`: core 2919, legacy containment 67, cabinets 27, D04 20, My Day 337; UI 1312 static assertions plus 4 tests; syntax 1204 files; required ownership/version/migration guards passed |
| Direct service PostgreSQL | **59/59 PASS**, 58 scenarios plus parent | `direct-services-after-compatibility.log`; actual SQL, constraints matching the relevant schema, triggers, concurrent transactions and cleanup |
| Actual HTTP/auth/PostgreSQL | **11/11 PASS**, 10 scenarios plus parent | `caller-http-postgres-liveness.tap`; actual route/auth stack with synthetic local membership and domain records |
| Final combined PostgreSQL | **70/70 PASS**, zero skipped | `postgres-verified.log`; runs both final files together, not a sum of reruns |
| Route smoke | **103/103 PASS** | `route-smoke-final.log`; SQL mocks, including existing MD input and foreign product rejection; not substituted for PostgreSQL proof |
| Focused caller/deadlock regression | **76/76 PASS** | `caller-deadlock-unit.tap`; includes actual HTTP handler with synthetic `40P01`, outer ROLLBACK, no COMMIT and no persisted booking |
| Protected booking/timeline guard | **PASS** | `protected-final.log`; 6 protected blocks, 4 forbidden needles, 2 regression files |
| Diff whitespace | **PASS** | `git -c core.safecrlf=false diff --check` |
| Generic linkedTo diagnostic | **REPRODUCED_NOT_FIXED** | 9 runner PASS = 6 defect characterizations + 2 controls + parent; **not a security PASS** |
| CI / deploy / browser / live | **NOT_RUN** | Local backend task; no UI change, no production identity or live behavior asserted |

Evidence paths above are relative to `.codex-temp/sys-mb-d04/`. Exact source and
artifact hashes and final baseline stage counts are in `RELATED_RECORDS_VERIFICATION.json`.
Windows runtime: Node **22.23.1**, npm **10.9.8**. PostgreSQL fixture runtime:
WSL Node **22.22.2**, PostgreSQL **16.15**.

The first full baseline failed 14 route-smoke cases because mock queries/rowCount
did not model the new guards. The fixtures were corrected narrowly; production
guards were not weakened. An intermediate combined PG run also exposed a
timing-dependent test lock wait. Its final fixture observes a real barrier and
uses NOWAIT to prove exclusion, without consuming the HTTP statement timeout.
These failed logs remain historical evidence, not final PASS results.

Run the final PostgreSQL pair locally:

```powershell
wsl -d Ubuntu -u postgres -- env BUSINESS_MEMBERSHIP_LOCAL_POSTGRES_TEST=1 node --test '/mnt/c/Users/Plotva/OneDrive/Документи/EventGenix/.worktrees/sys-mb-auth-p0-20260912/tests/integration/lead-related-records-postgres.test.js' '/mnt/c/Users/Plotva/OneDrive/Документи/EventGenix/.worktrees/sys-mb-auth-p0-20260912/tests/integration/customer-lead-business-isolation-postgres.test.js'
```

Fixtures refuse production/Railway contexts, never fall back to `DATABASE_URL`,
create uniquely named local databases and drop only those exact databases.
Database/session cleanup is verified. No external system or real record is used.

## Remaining READY/BLOCKED work

| Item | Status | Concrete next scope |
| --- | --- | --- |
| Independent lead/customer/booking/product ownership and rollback | **IMPLEMENTED_LOCAL** | Review this incremental diff and final manifest; no separate production claim |
| Generic booking `linkedTo` | **BLOCKED_PROTECTED_CHANGE / P1** | Exact reproducer, payloads and candidate insertion hunks in `LINKEDTO_PROTECTED_SCOPE.md`; proposed local scope `SYS-MB-D04-LINKEDTO-GUARD-LOCAL` |
| Deadlock-free coordination across callers | **OPEN / P2 reliability** | Establish common ordering before caller booking/lead/customer locks. Current 409/rollback/new-transaction retry is proven; automatic serialization/retry is not implemented |
| `POST /api/leads/mailing` ownership-change race | **OPEN / domain follow-up** | It still validates via the pool before a separate INSERT. Move validation/write to one transaction or guarded INSERT SELECT and prove concurrent ownership change denial; no new provider/send operation is needed |
| MD opaque-code ownership migration | **NOT_MIGRATED** | Inventory provider codes and define durable mapping before MD membership cutover; compatibility preservation is not product ownership certification |
| Continuation task 3 | **READY_ANALYSIS** | Historical owners/publicity/source mapping decisions, using this new checkpoint |
| Production cutover/global completion | **HOLD** | Protected linkedTo, remaining D05/domain decisions, acceptance and an exact authorized release block are still required |

The deadlock reproducer records the real cycle: A locks L2 and customer C then
waits for C's primary L1; B holds L1 and waits for C. PostgreSQL chooses a victim.
The durable PG regression verifies no victim changes, one survivor, and successful
whole-transaction retry. Reordering only the inner customer check is insufficient
because other callers already hold booking/lead locks. No in-transaction retry or
weaker ownership lock was introduced to conceal the cycle.

The protected linkedTo defect is reachable in the **local actual HTTP/PG fixture**:
generic POST/PUT accept foreign/missing parents while foreign detail GET is 404.
No foreign parent payload disclosure or mutation was demonstrated. This is not a
live exploit claim. The existing protected source manifest remains unchanged.

Preserve the ignored evidence artifacts when transferring this workspace. The
new SHA256 manifest identifies the exact reviewed source state; earlier manifests
are historical checkpoints, not expected to match later intentional edits.
