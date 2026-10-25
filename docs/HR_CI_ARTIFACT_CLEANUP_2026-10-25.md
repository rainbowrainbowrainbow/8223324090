# Approved CI artifact cleanup — 2026-10-25

Authorization: `EG-HR-CI-ARTIFACT-CLEANUP-20261025`.

The single approved pass removed exactly 20 artifacts from superseded/cancelled HR feature run `40147099708` (source `c82598f4eb6fd97853c99fee31e3386ba0f946ba`). All 20 DELETE requests returned 204 and every target was confirmed absent by a subsequent read-only lookup. Total confirmed removed: 190,632,623 bytes.

All original ZIP backups remain outside Git, verified against GitHub SHA-256 and exact byte size. The immutable approved manifest hash is `782a68ffa9afba8f34517a7a174261859194cf41805c1b164a70a009fd9bd2d6`; the per-artifact execution receipt is private. Original GitHub artifact IDs cannot be restored. Workflow logs were not deleted.

Post-checks: old run has 0 remaining artifacts; protected latest-green feature run `40147736871` retains 21 artifacts; protected live-production run `40118259177` retains 22 artifacts. No artifacts from other/current runs were deleted. No workflow, assertion, billing, permission, membership, DB, Railway setting or production branch/deployment change was made.

The independent Education acceptance readiness fix at `e5a9a3ea40ad11aa9fb1bc1e20fbd3cb6c5112dc` passed its actual-app browser test step in run `40204874284`; that job still failed its artifact upload before this cleanup. It now waits for the rendered editor before a real tab click and preserves Creator/reader UI and API permission assertions. This is not a product Timeline permission change or live QA.

This documentation-only commit starts one fresh exact-SHA feature CI after cleanup, retaining candidate v0.82.119. Artifact deletion alone does not prove the account quota has refreshed. All required jobs/uploads must actually pass. If quota remains, HOLD without any additional deletion, settings/billing change or scope expansion under this authorization. No deploy is authorized by this cleanup.
