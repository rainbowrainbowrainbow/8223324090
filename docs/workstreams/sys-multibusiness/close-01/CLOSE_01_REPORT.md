# SYS-MB-CLOSE-01 — implementation and readiness report

Date: 2026-09-22  
Status: `READY_FOR_AUTHORIZED_PRODUCTION_RELEASE`  
Production writes performed by this task: **0**

## Verified baseline

- Final isolated worktree: `C:\Users\Plotva\OneDrive\Документи\EventGenix\.worktrees\sys-mb-close-01-final-20260922`.
- Branch: `codex/sys-mb-close-01-final-20260922`.
- Current production branch head: `b3ea57bef3c6694fcc19be86011552ca2e97ed7c` (`v0.82.6` release source).
- Final live `/api/version`: `b3ea57bef3c6694fcc19be86011552ca2e97ed7c`, branch `codex/eventgenix-production`, version `0.82.6`, label `Omni: зрозумілий Facebook fallback`, with complete deployment-manifest metadata.
- The two Omni commits that appeared during this task were preserved by rebuilding this package on top of `b3ea57be…`. They were deployed by their own flow before the final read-only check; no force-push, reset, production data write, schema apply, mapping apply, or deploy was performed by CLOSE-01.

## Closed release defects

### CRM owner invariant

The CRM cutover receipt `29436fa0daf1ae01bdfaf7bfaf48680cf92dd77e899b4adc4646555903a07223` is treated as applied evidence and is not replayed from scratch.

The `activeOrganizationOwners=0` condition has a concrete cause: the reviewed CRM mapping described the agreed current owner as organization role `member`, and the previous upsert could demote an already-active owner. The local cutover implementation now:

- preserves an existing active `owner` during a business cutover;
- counts only active owners backed by active users in the active organization;
- fails and rolls the transaction back when the target organization has no active owner;
- keeps the technical platform `creator` role separate from organization/business ownership.

The exact repair payload is stored outside Git and binds the already-reviewed stable user ID and organization ID. It does not infer ownership from username or creator status. Canonical payload hash: `d20cdf51fbf60377993f442cbeac8222b51b87a0748981e9511545c743b8b242`.

### Cabinet and role lifecycle

`profile.html` now loads the existing cabinet, access-editor, and business-membership scripts plus their stylesheet. This closes the browser defect where the server rendered the management panels but the profile page never initialized them.

Maysternya timeline access now comes from the active business membership. `director`, `manager`, and `admin` receive only their scoped actions; `worker` remains denied. The technical platform creator remains a compatibility mechanism only before cutover and is not converted into an MD business role. Explicit action overrides and the non-delegable `manage_settings` capability remain enforced.

### Nine Park catalogs

The catalog cutover package requires the exact nine agreed roots and rejects any missing, extra, cross-owned, or token-drifted root:

| Catalog | Current status from reviewed preflight | Pages | Public token state |
|---|---:|---:|---|
| `122112` | inactive | 3 | existing, preserve |
| `21312` | inactive | 0 | none |
| `4214` | inactive | 0 | none |
| `Торти` | active | 1 | existing, preserve |
| `Костюми` | active | 0 | none |
| `Випускний` | active | 8 | existing, preserve |
| `Меню` | active | 0 | none |
| `Піньяти` | active | 4 | none |
| `Торти з грибів` | inactive | 1 | none |

The four absent from the active-list API are inactive records, not missing ownership records. The implementation assigns root and durable child rows atomically, records a hash-bound journal/receipt, verifies a fresh fingerprint, supports exact replay, and leaves shared image blobs unassigned because blob consumers are shared. It does not activate catalogs, generate or rotate tokens, republish content, or infer asset ownership from filenames.

Private catalog mapping hash: `0ce0adbf5b372c443a716eabab1869f910d5af3025fb5f2a88ff175d9d310fb0`.

### Telemetry and exit gate

Telemetry now covers HTTP/profile admission, service/domain decisions, alternate authentication, WebSocket serialization, public/provider ingress, jobs/retries, and operator paths. Admission is recorded independently from successful domain access. Durable v2 hourly counters and runtime reconciliation detect eligible, persisted, and failed events across restart/deploy boundaries.

The report passes only when all of these are measured in production:

- both CRM and Maysternya have successful receipts and live exact-SHA proof;
- `max(14 complete UTC days, longest enabled cycle + 24h)` elapsed;
- each migrated business has at least 30 real membership-authorized HTTP operations on at least 5 distinct days;
- every configured entry family has coverage;
- no allowed compatibility decisions, unregistered accepted operations, unexplained gaps, or counter loss remain.

`PASS_MEASURED` is intentionally impossible to obtain from fixtures. Current global status remains `HOLD_MEASURED`; `GLOBAL_MODEL_COMPLETE=false`.

## Maysternya release readiness

The local package is runnable for the authorized release sequence:

1. additive migrations `368` and `369`;
2. post-schema bounded read-only preflight;
3. verify the existing CRM receipt without replaying CRM cutover;
4. apply the exact owner repair only if its predicates still match;
5. prepare/apply the exact nine-catalog ownership mapping with a fresh DB fingerprint;
6. prepare/apply Maysternya with mapping hash `7efec32812aa093d5cfb5ce390e4faa68cf36342d13c90aa40d462d8fed6a162`, locks, conflict detection, receipt, replay, and transaction rollback;
7. run read-only owner/director/manager/admin/worker live QA with existing approved test accounts, prove no production QA fixtures were created, and start the measured observation window.

External MD program IDs, provider admission, no-write `dryRun`, jobs/outbox/retry ownership, and recipient containment are included in the existing guarded domain package and acceptance matrix. No real sends, payments, generation, or provider mutations are part of QA.

## Verification

- Runtime: Node `22.23.1`, npm `10.9.8` — PASS.
- Focused cutover/catalog/telemetry/timeline/WebSocket tests: 69/69 — PASS.
- `npm run test:sys-mb` — PASS.
- `npm run test:ui` — PASS.
- `npm run check:migrations` — PASS, migrations 001–369, new migrations 368/369 satisfy governance metadata.
- `npm run check:syntax` — PASS, 1294 JavaScript files.
- Access, auth-boundary, API/static/scheduler/DB-startup/Service Worker ownership guards — PASS.
- Actual Express→PostgreSQL plus browser acceptance: run `d06_1790079382156_b96074` — PASS for all domain, ownership, rollback/concurrency, same-JWT revoke, two-organization, four-business, cross-tab, late-response, keyboard, cleanup, and 390/768/1440 scenarios.
- Production compatibility duration/traffic gate: `NOT_TESTABLE` locally by design.
- Production public links: `NOT_TESTABLE` in this read-only task because private tokens were not exposed and the bounded DB lease was not active. The exact three-link check is part of the authorized release QA and must not print tokens.

The earlier broad `npm test` attempt reached the Windows unit-test launcher limit (`The syntax of the command is incorrect`) rather than a product assertion. The release-relevant suites above were run independently and passed; CI remains the canonical full automated gate for the exact release SHA.

## Remaining release actions

There are no open local release-blocking required-domain defects. The remaining actions require a production authorization block: commit/version/push, exact-SHA CI, Railway helper deploy, migrations, bounded read-only preflight, three approved data applies, live role/domain/public-link QA, cleanup, and observation start. The exact request is in `CONTEXT_HANDOFF.md`.
