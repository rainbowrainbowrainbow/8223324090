# SYS-MB RECOVER-02 release manifest

Status: RELEASE_CANDIDATE_PACKAGE_READY / PRODUCTION_APPLY_HOLD

## Current live baseline

- Live URL: `https://8223324090-production.up.railway.app`
- Live branch: `codex/eventgenix-production`
- Live SHA checked read-only: `487e9e872cef1455627aa0d6d31a9ef2ce9d7211`
- Live version: `0.81.154`

## Candidate content to carry into a clean production worktree

Code/auth/registry:

- `services/businessCutover.js`
- `routes/organizations.js`
- `services/accountAccessPolicy.js`
- `config/permissionRegistry.js`
- `services/businessModuleRegistry.js`
- `services/legacyBusinessSurface.js`
- `services/websocketEventAccess.js`
- `scripts/production-block-policy.js`
- `scripts/production-block-controller.js`
- `scripts/sys-mb-compatibility-telemetry-report.cjs`

Migrations:

- `db/migrations/357_organizations_business_memberships.sql` if not already present in production candidate history.
- `db/migrations/363_multibusiness_cutover_journal_telemetry.sql` if not already present in production candidate history.
- `db/migrations/364_catalog_ownership_markers.sql`.
- `db/migrations/365_business_cutover_journal_approval_receipts.sql`.

Tests/docs:

- Business membership/cutover/legacy/websocket/production-block tests touched by this package.
- `docs/workstreams/sys-multibusiness/recovery-02/*`.

## Private operator package

Private directory only, not Git:

- `approved-maysternya_doli-apply-payload.json`
- `approved-crm-apply-payload.json`
- `approved-business-mapping-summary.json`
- `recover-02-ownership-preflight.json`

Public hashes:

- `maysternya_doli` mapping hash: `7efec32812aa093d5cfb5ce390e4faa68cf36342d13c90aa40d462d8fed6a162`
- `crm` mapping hash: `3e653c3f12cc4edb3476cf4f5a9f06e1f2fbf865a2d410459fccca9163e50a86`
- source snapshot hash: `458fbd72aafaf3708f2e80ad85893418d9122c0a5c7487ffe3f3de6dc12a757b`

## Required production block

Before production push/deploy/apply, prepare one exact protected block from a clean candidate:

```powershell
npm run codex:production-block -- prepare -- --release-label "SYS-MB MD/CRM cutover recovery" --protected-workflow sys-mb-auth-cutover --max-release-attempts 3
```

The block must sign the exact current production baseline, candidate SHA, migration list, changed paths and protected workflow. Do not use a generic Red bypass.

## Release sequence

1. Create clean candidate from the current live production SHA/branch.
2. Cherry-pick/apply only SYS-MB RECOVER-02 hunks and required previous SYS-MB migrations/code not yet in production.
3. Run local checks listed in `VERIFICATION_MANIFEST.json`.
4. Prepare exact `sys-mb-auth-cutover` production block.
5. After explicit user authorization of that block: commit, version bump, push to `codex/eventgenix-production`, wait for exact-SHA green CI, deploy using the Railway helper only.
6. Confirm `/api/version` exact SHA/branch/version/label.
7. Run read-only preflight again, compare DB fingerprint and mapping hashes.
8. Apply MD and CRM one at a time only with the approved private payload and matching fingerprint.
9. Run owner/worker live QA and start telemetry measurement.

## Readiness

- Code package: READY_LOCAL.
- Migration package: READY_LOCAL.
- Private mapping package: READY_FOR_DRIFT_CHECK.
- Production apply: HOLD until current production candidate, exact block and refreshed fingerprint are present.
- Compatibility removal: HOLD until telemetry exists live and PASS_MEASURED window completes.
