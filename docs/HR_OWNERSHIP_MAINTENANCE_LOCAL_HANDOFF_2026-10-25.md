# Ownership maintenance release — local implementation handoff

Date: 2026-10-25. Authorization: `EG-HR-OWNERSHIP-MAINTENANCE-LOCAL`.
Production impact: yes for a future cutover; this block made no production changes.

## Decision and scope

Implemented an explicit maintenance path inside the canonical `release:railway-up` helper. The normal online path still requires live metadata, descendant/version checks, clean Git export and its existing CI/smoke guards. Generic live errors do not select maintenance mode. No deployment, stop, Git push, DB mutation/grant, membership change, settings change or version bump was performed.

Files added/changed in this block:

- `scripts/railway-release-up.js`: explicit CLI modes, read-only exact workflow CI reader and maintenance adapter using the existing archive/manifest/smoke functions.
- `services/releaseMaintenance.js`: pinned private manifests, ownership receipts, artifact hashes, stopped-service/rollback guards and durable attempt records.
- `tests/integration/hr-ownership-operator.integration.test.js`: adds a real separate-login audit-role recovery regression on disposable PostgreSQL.
- `tests/release-maintenance.test.js`: deterministic positive/failure/recovery tests, real disposable Git archive and canonical loopback version smoke.
- `tests/release-railway-up-predeploy.test.js`: registers these tests in the existing release CI lane. No CI settings/jobs changed.
- This runbook and the appended implementation note in the original proposal.

The earlier uncommitted ownership operator, tests and preparation files remain intact. No main checkout or other worktree was changed.

## Enforced preparation and upload contract

1. `prepare` is read-only outside private local files. It requires a clean release worktree, exact pushed production ref, green CI for release and baseline, healthy canonical live identity and a stable Railway deployment. It obtains both source packages from their exact Git objects and exports both archives before any service shutdown.
2. Private proofs bind approval reference, migration/audit/plan/database/schema hashes, audit/inventory observation timestamps and an expiry no later than 30 minutes after proof creation. Old audit evidence cannot be refreshed merely by creating a new manifest. Freshness is checked again before upload.
3. The sealed manifest contains target, baseline identity, release/rollback artifact hashes and CI proof. Its raw SHA-256 must be separately reviewed/pinned in the authorized production plan. A CLI approval string or hash is not itself human authorization. All private manifests, receipts and archives stay outside Git.
4. `forward` requires the exact old deployment REMOVED, deploymentStopped=true, no active deployment, matching source/image identity, unavailable canonical endpoint, a reviewed COMMITTED APPLY receipt and untouched archive. Receipt must match every reviewed ownership hash, original live/release SHA and authorization; it expires for upload after five minutes.
5. CI verification reads the latest push workflow attempt for the exact SHA and canonical branch, rejects incomplete/paginated-away evidence, and requires every job successful, including baseline, Omni, HR browser and PostgreSQL. The authenticated read-only production probe verified 23/23 jobs on the current live SHA. An unauthenticated GitHub API request returned 404; no bypass was used. Operators must supply existing GitHub authorization process-locally, never in repo files or logs.
6. Gates repeat immediately before upload, including refs, CI, artifact, receipt age, platform state and endpoint. They are checked again after potentially slow CI/artifact work. The upload uses the same clean archive, exact deployment manifest and explicitly fixed project/environment/service as the online helper. Unique CLI message binds an attempt to platform deployment evidence.
7. Attempt files are exclusive and file-fsynced before upload. The `.result` file records the observed deployment ID/image after upload, even when the CLI reports failure. Never rerun an uncertain upload automatically. Drift after upload stops subsequent release actions while preserving its evidence.
8. `rollback` uploads only the prepared baseline artifact while Git HEAD and remote production remain at the reviewed candidate SHA; it does not rewind or force-push a branch. It requires green baseline CI, a fresh reviewed COMMITTED ROLLBACK ownership receipt and the pinned forward-attempt result. The known new deployment must be stopped, with matching ID, unique message and image. A proved second-gate failure before upload can instead restore from the original stopped baseline identity. Rollback uses the baseline package/label and version smoke from that exact captured archive.

The helper never performs ownership writes or shuts down writers. The separately reviewed operator must establish current DB identity, full writer inventory, quiescence and exact receipt/row-version checks. Railway status plus an old DB session snapshot is not a guarantee that an external job cannot reconnect.

## Future operator command shapes — NOT authorized for production by this local block

Use explicit arguments to the canonical entrypoint. `RELEASE_DEPLOY_BRANCH` must be `codex/eventgenix-production`. Use existing local/process-only authentication. No token belongs in an argument, manifest, receipt, document or log.

Preparation arguments:

```text
npm run release:railway-up -- --branch codex/eventgenix-production
  --maintenance-mode prepare
  --maintenance-approval <future-exact-cutover-block>
  --maintenance-proofs <private-reviewed-proofs.json>
  --maintenance-proofs-sha256 <lowercase-raw-file-sha256>
  --maintenance-manifest <new-private-manifest.json>
```

The proofs file contains `approvalRef`, `createdAtUtc`, `expiresAtUtc`, `auditObservedAtUtc`, `inventoryObservedAtUtc`, `migrationHash`, `auditProofHash`, `planHash`, `databaseFingerprint`, `foundationFingerprint`. Hashes are actual reviewed values, not example defaults. The branch must already point to the exact green candidate, live must still identify the confirmed baseline, and the forward version must be newer. Current local v0.82.117 is not a prepared production release candidate.

Forward validation/upload arguments:

```text
npm run release:railway-up -- --branch codex/eventgenix-production
  --maintenance-mode forward
  --maintenance-approval <same-future-cutover-block>
  --maintenance-manifest <private-manifest.json>
  --maintenance-manifest-sha256 <reviewed-raw-file-sha256>
  --maintenance-receipt <private-committed-apply-receipt.json>
  --maintenance-receipt-sha256 <reviewed-raw-file-sha256>
  --maintenance-attempt <new-private-attempt.json>
```

Add `--dry-run` to perform all gates without upload or attempt creation. Even dry-run needs genuine stopped state and receipt; it is not a way to simulate production identity. `--parse-only` only checks argument parsing and is not release proof.

Rollback uses the same command with mode `rollback`, the fresh committed rollback receipt, a new rollback attempt path, and `--maintenance-forward-attempt <forward-attempt.json.result>` plus `--maintenance-forward-attempt-sha256 <reviewed-raw-file-sha256>`. It restores the original prepared artifact, not an operator-selected commit.

## Explicit HOLD and recovery limits

- Unknown COMMIT must be resolved using the operator's repeatable-read read-only recovery before a COMMITTED receipt can be used. This helper cannot promote COMMIT_PENDING to COMMITTED.
- Changed inventory/row versions, an unknown upload result, missing image identity, missing `.result`, private receipt disk failure, foreign/replacement deployment or new production ref requires HOLD and a concrete reviewed recovery decision. It does not justify guessing an image or retrying an upload.
- In particular, a build failure with no trustworthy image identity is not supported by the automatic rollback guard. Before production shutdown, the final operator plan must explicitly cover that failure and receipt-storage recovery. Do not describe this local helper as a fully rehearsed cloud cutover.
- Prepared archives are intentionally retained for rollback. Cleanup must target only those recorded private exports after final release/recovery verification, not broad temp cleanup.
- Real Dar -> Park live evidence is a separate outstanding QA item. No fixture is created/reactivated by this block.

## Verification

- Existing release/static tests plus new cases: 116/116 PASS, including 24 maintenance cases. Registered in the existing pre-deploy/version-tooling lane.
- The real Git test proved that an older captured package produces the correct deployment manifest and passes the unchanged canonical version smoke on a loopback test server, even when the checkout has a newer package.
- Current production Git/live remained v0.82.117 / `34293c9b1e52ac1e3b4f9bde6262276e0bf0e19b` during read-only preflight. Its authenticated CI probe returned 23/23, https://github.com/rainbowrainbowrainbow/8223324090/actions/runs/40118259177.
- Full local baseline and final checks: see completion addendum.

## Next gates

Review the local diff, then separately authorize scoped feature commits/push and exact-SHA CI. Reconfirm current production and release version before preparing that candidate. Production ownership attribution, writer stop/restart, integration/deploy and any new audit lease need their own exact bounded authorization after the candidate and recovery plan are reviewable. This local authorization grants none of those actions.


## Completion and pre-attribution recovery addendum

Full `npm test` completed with exit 0 on Node 22.23.1 / npm 10.9.8 (3916 core unit and 347 My Day tests, plus UI, sys-mb and timeline-marketing suites). The final recovery refinements were additionally checked by the final `npm run test:version-tooling` run: 131/131 PASS, including 24 maintenance cases. Final disposable PostgreSQL operator/recovery run: 14/14 PASS. The broad baseline finished before the last no-apply recovery refinements; those refinements were verified by the focused release and PostgreSQL suites rather than another full baseline.

A safe restore before attribution is implemented. `createNoApplyRecoveryProof` accepts an existing, separately authenticated `eventgenix_audit_ro` client, requires both session_user and current_user to be that role and REPEATABLE READ READ ONLY, verifies stopped-writer evidence, database identity and the reviewed inventory, then uses the existing read-only operator recovery to prove NOT_COMMITTED. The narrow no-apply producer only supports an absent foundation/ledger; partial or already-installed foundation without matching before-images causes HOLD. It makes no DB writes and cannot open a connection. Write its returned proof using the private operator receipt store, not to Git.

Rollback can consume this reviewed READ_ONLY_RECOVERY / VERIFIED_NOT_COMMITTED envelope for 60 seconds, without a forward-attempt result, only while the original baseline deployment remains stopped and the sealed forward-upload marker is absent. This covers shutdown followed by an aborted or unstarted attribution without fabricating a committed rollback. A durable marker is written exclusively immediately before any upload; it prevents treating an uncertain forward upload as never started. Each mode has its own manifest-bound marker.

All test credentials/roles were synthetic and confined to the disposable loopback database. Its container was removed after the final test. No production stop, DB change, grant, membership, commit, push, deploy or release marker change was made. Final local HEAD remains the pre-existing feature HEAD; new changes remain uncommitted. New feature exact-SHA CI and a separately authorized production cutover remain open gates.
