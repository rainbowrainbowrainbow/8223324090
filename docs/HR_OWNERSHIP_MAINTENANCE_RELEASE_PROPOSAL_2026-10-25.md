# Proposed bounded maintenance release path — 2026-10-25

Status: HISTORICAL PROPOSAL. The separately approved local implementation is complete; see HR_OWNERSHIP_MAINTENANCE_LOCAL_HANDOFF_2026-10-25.md and the implementation update below. Production cutover still requires its own exact authorization.

## Problem and recommendation

The reviewed ownership candidate moves six legacy tables to owned reads/writers. Attribution must occur with all legacy writers stopped. The mandatory helper currently requires a healthy live `/api/version` before upload, so stopping the service first leaves no valid deployment/recovery route.

Recommend an explicit, fail-closed maintenance mode in the existing helper. A staged bridge release is an alternative, but requires another runtime writer/reader contract and extra rollout/recovery states. Do not weaken the normal online release path or bypass it with a standalone uploader.

## Proposed implementation boundary

Only the existing release helper, focused release-tooling tests, and operator runbook. No Railway settings, auth, membership, additional migrations, HR projections or account/payroll boundaries. Reuse the existing exact-SHA CI, clean git archive export, manifest and version smoke logic.

1. Before shutdown, capture a private, reviewed maintenance manifest from healthy live metadata and Railway status. Bind exact live/release SHAs, branch, version, target project/environment/service, deployment/image digest, current remote refs, migration/inventory/audit hashes, approval expiry and rollback artifact. An arbitrary JSON file is not sufficient authority; validate every field against the reviewed authorization and current platform/Git evidence.
2. Normal releases continue to require healthy `/api/version`. Offline maintenance is explicitly selected and accepted only when the exact former deployment is REMOVED, deploymentStopped=true, no active deployment exists, source/image fingerprint is unchanged, CI and remote refs match, and the authorization/evidence remain fresh. A healthy but conflicting live version must fail, not silently enter offline mode. Unknown platform status, changed source, expired manifest or concurrent deployment must fail.
3. Validate all release prerequisites and export both reviewed release and rollback artifacts before stopping anything. The helper must still upload only its clean archive with exact deployment manifest; no alternate URL, mocked response, raw CLI path or settings change.
4. After separately authorized writer shutdown and fresh ownership audit, perform the reviewed atomic schema/attribution operation using durable private receipts. Deploy the owned writer release only after COMMIT is established. Unknown COMMIT must go through read-only recovery first; never retry attribution blindly.
5. Recovery must be concrete before approval: after an unsuccessful new deployment, stop/verify all new writers, verify unchanged row versions, reverse only receipt-owned pairs if safe, then restore the captured previous artifact through the same helper. Additive schema stays. The helper must have an explicit reviewed rollback mode for the previous version; normal forward version guards must not be disabled globally. Any row drift means HOLD for manual review, not broad undo.
6. Recheck exact live SHA/branch/version, owned queries, restricted/error states and safe test-account GET QA after restoration or release. Record stop duration, all operations and recovery result without structural row IDs or secrets.

## Required deterministic tests

- Normal online path unchanged; no maintenance fallback on generic HTTP errors.
- Missing/stale manifest, approval mismatch, foreign project/service/source/image, active/replacement deployment, remote drift, wrong release SHA/version, failed/pending CI and arbitrary baseline all rejected before upload.
- Valid stopped-service maintenance path retains exact-SHA CI, clean export, deployment manifest and post-deploy smoke.
- Healthy live mismatch rejected; cannot spoof live through a user-provided endpoint.
- Expiry/drift between preflight and upload fails closed; rollback mode permits only the captured prior artifact under the same reviewed maintenance block.
- Lost COMMIT and receipt failures use the already rehearsed operator recovery, with no duplicate mutation.

## Separate production approval still needed

After local helper implementation and feature CI review, obtain one exact bounded cutover block naming the six-table attribution, maintenance stop/restart, production push/deploy, rollback route, private receipt handling, audit freshness, attempt/time limits and safe QA. A SELECT audit lease is not an attribution or deployment authorization. Do not reuse retired DB leases. Do not activate a Dar fixture without its own exact approved plan.

## Implementation update — 2026-10-25

The separately authorized `EG-HR-OWNERSHIP-MAINTENANCE-LOCAL` block implemented the local helper path and tests. See `HR_OWNERSHIP_MAINTENANCE_LOCAL_HANDOFF_2026-10-25.md` for actual behavior, test evidence and explicit recovery HOLD limits. The earlier proposal above remains historical scope; it is not a production approval or proof of cloud cutover. No production action occurred.
