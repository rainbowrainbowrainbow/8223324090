# Park HR ownership operator — local preparation, 2026-10-25

## Status

LOCAL_REHEARSAL_PASS. Production cutover remains HOLD. This document is not an authorization to stop the service, write production data, push, or deploy.

Verified production: v0.82.117, `34293c9b1e52ac1e3b4f9bde6262276e0bf0e19b`, branch `codex/eventgenix-production`. Production CI: https://github.com/rainbowrainbowrainbow/8223324090/actions/runs/40118259177. A read-only live probe during this preparation confirmed the same identity and correctly rejected the active service as maintenance evidence. No service was stopped.

The separately authorized ownership audit found 408 records across the six legacy tables (35/93/7/264/2/7), no conflicting owner signals, and matching frozen inventory. Its temporary registry SELECT lease was retired with the initial ACL fingerprint restored. That audit permits preparation; it does not authorize attribution or remain fresh indefinitely. Private inventory and receipts stay outside Git.

## Local changes

- `scripts/park-hr-ownership-operator.cjs`: library-only apply, exact rollback, read-only uncertain-COMMIT recovery, and private receipt storage. No credential discovery, connection creation, or production apply CLI.
- `scripts/park-hr-maintenance-proof.cjs`: read-only, fixed-target Railway status and current DB writer-session checks; no stop/deploy/settings operation.
- `tests/hr-ownership-operator.test.js`: review gates, receipt integrity, maintenance identity and fail-closed session checks; registered in the existing unit command.
- `tests/integration/hr-ownership-operator.integration.test.js`: real disposable PostgreSQL failure/recovery cases; included in the existing ownership integration lane without changing CI settings.

Apply binds the reviewed six-table structural inventory, target Park registry pair, database fingerprint, exact migration hash, schema fingerprint, audit hash, live/release SHA and bounded approval context. Schema/ledger/attribution are atomic. Receipt after-images and row versions persist before COMMIT. Lost acknowledgement is UNKNOWN until a separate REPEATABLE READ READ ONLY recovery establishes the result; no blind retry. Rollback refuses inventory or row-version drift and clears only owner pairs recorded by the reviewed apply receipt. Additive schema and ledger remain after rollback.

Maintenance evidence binds the exact project/environment/service, previously verified live SHA/branch, removed deployment and image digest, and an empty authoritative active deployment set. Manual Railway uploads legitimately report null repo/image source fields; image digest and separately verified live identity are required instead. A truncated deployment history is not accepted as proof that no deployment is active. DB statistics are refreshed; other writable or unknown sessions cause HOLD. External job/operator inventory must still be reviewed: a session snapshot does not prevent future connections or replace writer shutdown.

## Verification

- Node 22.23.1 / npm 10.9.8 runtime check: PASS.
- Focused ownership plan/operator tests: 12/12 PASS; maintenance tests rerun after native Windows CLI and manual-image identity fixes: 5/5 PASS.
- Minimal pre-foundation disposable PostgreSQL operator rehearsal: 12/12 PASS.
- Full app-schema disposable ownership integration: 20/20 PASS (8 existing + 12 operator cases). On this Windows host, cold initialization used the existing diagnostic wrapper with a 600-second startup budget; the normal runner default is 180 seconds. Assertions, loopback/reset guards and cleanup remained unchanged. This is not evidence that the default cold-start budget passes locally.
- Real Railway status/live-version probe: PASS; active production service rejected with APPLICATION_WRITERS_STILL_ACTIVE. No stopped-cloud-service rehearsal was performed.
- Disposable schema cleanup confirmed zero public tables; only this run's disposable container was removed.
- Full npm baseline: see final verification addendum below.

PostgreSQL cases cover atomic foundation/ledger/attribution, SQL failure rollback, receipt failure before mutation, lost COMMIT acknowledgement, final receipt-write failure, changed-row rollback refusal, new-row inventory drift, writer resumption, database/pending-migration mismatch, unreviewed RLS/triggers, idempotent no-op recovery and read-only recovery mode. Railway stop evidence in disposable integration is synthetic and must not be described as real cloud-stop QA.

## Remaining release blocker

The unchanged `scripts/railway-release-up.js` fetches live `/api/version` before upload and fails when it is unavailable. Therefore the proposed stop-writers -> atomic attribution -> deploy-owned-writers sequence cannot currently use the mandatory helper. Do not stop production until a reviewed recovery/deploy path is implemented and tested. Raw `railway up`, endpoint spoofing and timing a deploy around the guard are prohibited.

See `HR_OWNERSHIP_MAINTENANCE_RELEASE_PROPOSAL_2026-10-25.md` for the narrow proposed workflow change. No release helper, HR API, permissions, membership or production schema/data were changed in this preparation.

## Other open evidence

Real live Dar -> Park late-response QA remains distinct from deterministic browser/disposable coverage. Do not claim a new two-business live run or reactivate a fixture under this task. Existing HR card/Today/Structure functionality is not being reopened as a product defect solely because this evidence is incomplete.

## Additional real session regression

After the 20-test full-schema run, a further integration regression exercised the maintenance verifier SQL on a real disposable PostgreSQL connection: an idle writable connection caused HOLD, and closing it followed by refreshing the statistics snapshot returned zero other writable sessions in the same transaction. The final minimal-schema operator suite passed 13/13. Its Railway stopped state was synthetic. The temporary container was removed after completion.

## Final baseline result

`npm test` completed with exit code 0 on Node 22.23.1 / npm 10.9.8. Core unit suite: 3916/3916; My Day suite: 347/347. UI smoke, sys-mb and timeline-marketing checks also completed successfully. No failing TAP cases were reported. Focused final ownership tests passed 12/12. Parser, version, migration and protected-surface checks passed; migration 387 retained SHA-256 `0b5f3cd7fbc80dd966f3f7a6f2dc890b011ed1b7165536f766c821f5fe4d2a97`.

This preparation remains uncommitted locally. No new feature CI was run, no push/deploy was attempted, and no product version bump occurred. Last read-only live/remote comparison matched `34293c9b1e52ac1e3b4f9bde6262276e0bf0e19b`. The next protected implementation decision is the proposed local maintenance/rollback helper change; production attribution still needs a separate exact approval after that path is tested.
