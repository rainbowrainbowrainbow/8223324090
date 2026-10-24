# HR ownership cutover rehearsal — 2026-10-24

Status: local rehearsal completed; production ownership cutover remains HOLD. This is hardening of the already delivered Park HR reads, not a new permission expansion.

## Refreshed base

Live and remote production agree on 34293c9b1e52ac1e3b4f9bde6262276e0bf0e19b / v0.82.117. Exact production CI is successful: https://github.com/rainbowrainbowrainbow/8223324090/actions/runs/40118259177.

The ownership feature merged that base normally in local commit d381b0d4f9bb88f835e9f670303249f8049f82bb. All five intervening production commits, Afisha behavior, Education readiness correction and release markers were preserved. HR HTML and Check-in differences were cache/version markers; no ownership runtime change conflicted. There was no production push or deploy.

The prior feature CI 40015682204 belongs to edb891cb72ec8d580153ca616de57d27d1071e1d. It does not prove the newly merged feature or this rehearsal diff. New exact-SHA CI is still required before promotion.

## Executed evidence

Node 22.23.1 / npm 10.9.8. Dedicated loopback PostgreSQL 16, isolated database guards, ordinary initialization/migrations and automatic public-schema cleanup.

- Ownership plan/review unit tests: 7/7.
- Ownership Express/PostgreSQL suite: 8/8, including all original five cases.
- A queued legacy INSERT was observed in PostgreSQL wait_event_type=Lock before COMMIT, then completed afterwards without owner metadata. Owned readers correctly excluded that row, and the frozen backfill plan rejected the delta instead of adopting it. A table lock is therefore not a complete writer handoff.
- A new explicit-owned INSERT remained visible after backfill. Receipt rollback refused structural drift and left both rows owned. Only after deleting that separate synthetic delta in the disposable fixture did the exact original rollback succeed. This is not permission for analogous production deletion.
- Private review SQL was executed only against the disposable target. It checked the exact frozen structure, applied parent-first ownership inside the transaction and always rolled back. Quoted profession keys including dollar-delimiter text were covered. A changed structural field was rejected before attribution persisted.

The default 180-second cold-start budget failed on this Windows host. An ignored local diagnostic wrapper extended only that startup budget to 600 seconds; the tracked runner, scenario assertions, safety guards and CI were unchanged. The final eight-test run passed with this diagnostic budget. An earlier intermediate run failed while the new renderer was syntactically incomplete; it is not reported as a passing final run. Focused unit tests also exposed a shared-array test-fixture alias; the fixture now clones its columns without weakening assertions.

## Review-only SQL artifact

scripts/render-park-hr-ownership-review.cjs consumes the existing private plan and emits private SQL outside Git. It has no pg import, connection or apply mode. It resolves the output parent through realpath, refuses repository output and refuses overwriting existing files. Only approved structural columns are rendered. Dollar quoting and the enclosing procedural delimiter are content-bound. It checks target registry identity, frozen row sets, foreign/partial ownership, affected counts and postconditions, and ends in ROLLBACK.

Usage: node scripts/render-park-hr-ownership-review.cjs --plan <private-plan> --out <private-file-outside-Git.sql>.

Do not turn this preview into a production executor by replacing ROLLBACK. It has no durable changed-row receipt and does not stop old processes. No SQL from this artifact was sent to production, even as a rolled-back experiment. A production executor needs separate review and authorization, writer handoff and durable recovery mapping.

## Fresh read-only production evidence

At 2026-10-24T19:53:54Z the six-table structural inventory matched the earlier private inventory: 35 / 93 / 7 / 264 / 2 / 7, total 408 rows. Seven checked parent-link violation aggregates were zero. Private inventory and plan stayed outside Git; no attribution was executed.

At 2026-10-24T19:57:18Z the existing pre-cutover audit was run against its matching legacy reader source. Staff count was 217; item, progress, assignment and onboarding orphan/invalid-link counts were zero; linked non-Park onboarding tasks zero, linked Park tasks 20. Ten legacy read queries passed read-only EXPLAIN. These link/query observations and the recorded human Park owner decision are evidence, not a complete current registry/membership provenance GO.

At 2026-10-24T19:54:36Z authenticated GETs reconfirmed the original membership fingerprint, Park default, inactive Dar and Park-only single scope. No fixture reactivation occurred.

At 2026-10-24T20:04:34Z the existing lease helper was called in catalog-only plan form through eventgenix_audit_ro in REPEATABLE READ READ ONLY. SELECT is missing for exactly public.organizations, public.businesses, public.organization_memberships and public.business_memberships. ACL fingerprint: 78b71644d422a521c9d2f6be540dc7e8010037c83be6491a25bb3da993a057a9. No admin connection, GRANT, REVOKE or lease was used. A new exact bounded authorization is needed before acquiring those rights for full provenance.

## Remaining release gates

1. Choose and rehearse a concrete operational handoff that prevents old HTTP/background writers from resuming after COMMIT. The current rehearsal proves the need; it does not claim old writers are stopped in production. A maintenance window or a separately reviewed staged compatibility rollout requires an explicit scope decision. Startup schema advisory locks do not fence ordinary writers.
2. Prepare/review the actual bounded production executor and durable receipt recovery, not a bypass of disposable-only helpers or a changed review preview. Review actual migration 387, all other pending migration differences and the rollback binary.
3. Obtain fresh complete staff provenance and active registry/membership proof. Missing registry privileges are an exact audit HOLD, not authority to grant or infer ownership from zero orphans. The present inventory is not self-renewing permission to adopt new rows.
4. Before production DDL/DML/push/deploy obtain a new precise authorization naming schema, exact real-row attribution, current base, writer window and recovery. Old six-hour LOCAL-IMPLEMENT/proof envelopes cannot be reused for these protected actions. Recheck refs, version collisions and exact-SHA CI.
5. Real Dar-to-Park live QA remains incomplete. Synthetic tests and the former 35-second retired fixture are separate evidence. No new temporary membership is authorized by this local rehearsal.

The unrelated non-UTC payroll/date portability observation remains outside scope; no attendance/payroll normalizer changed.
## Final local baseline and delivery boundary

The complete npm test baseline passed on Node 22.23.1 / npm 10.9.8 after integration with production v0.82.117. The main unit sweep passed 3911/3911; My Day 347/347 and all remaining baseline stages completed successfully. The final standalone ownership-plan suite passed 7/7; the final disposable ownership suite passed 8/8. The task-owned database public-schema count was zero before stopping/removing its exact container. No unrelated Docker service was stopped.

The private review SQL SHA-256 is 4981a998c8f9362f54d99eebf2d8893dc560ecd5f27bacaa7f74efd95454ece5. The generator was invoked only offline; the production connection was never given that SQL.

Final GET /api/version and remote production recheck still agree on 34293c9b1e52ac1e3b4f9bde6262276e0bf0e19b / v0.82.117. Migration 387 is unchanged (SHA-256 0b5f3cd7fbc80dd966f3f7a6f2dc890b011ed1b7165536f766c821f5fe4d2a97). Runtime HR code, server access guards, release markers, real records and memberships were not changed by this rehearsal continuation. Only a local feature commit is prepared; no new feature push/CI or production promotion is claimed.
