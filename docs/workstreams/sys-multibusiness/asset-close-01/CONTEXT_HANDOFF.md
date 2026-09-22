# SYS-MB-ASSET-CLOSE-01 — context handoff

## Production readiness checkpoint — 2026-09-22 21:05 UTC

Read [PRODUCTION_READINESS_20260923.md](PRODUCTION_READINESS_20260923.md) first. Live and remote production remain `ac6efaeb85b238f3eeb1cac7c9e0e8c5d024fe79 / v0.82.11`; the pending diff is documentation, not a product candidate. Live registry has one organization. The only organization creation route is first-only bootstrap; local two-organization acceptance created its fixture by SQL. Read-only cycle inventory found an unpaused monthly reset scheduler, zero active recurring templates/announcements and no eligible event queue retry. `observation.startUtc` remains null. Do not deploy a documentation-only release or delete legacy authority to imply completion.

## Live role QA result — 2026-09-22 19:57 UTC

The owner approved `SYS-MB-CLOSE-03-LIVE-ROLE-QA-20260922`. The bounded Maysternya/CRM role sequence and same-JWT revoke passed for the existing smoke account. Both temporary memberships are inactive after exact API cleanup; Park remains active `senior_manager` and default. Two inactive membership rows and security audit records remain. See [ROLE_QA_REPORT.md](ROLE_QA_REPORT.md) for receipt hashes, browser classification and residual HOLD. The pre-approval section below is historical. `observation.startUtc` remains null because two-organization and independent worker-browser acceptance, enabled-cycle bound and entry-family/real-traffic evidence are incomplete.

## Live role QA preparation — 2026-09-22 19:46 UTC

Read [ROLE_QA_MANIFEST.md](ROLE_QA_MANIFEST.md) before any membership mutation. A read-only creator API preflight on live `ac6efaeb85b238f3eeb1cac7c9e0e8c5d024fe79 / v0.82.11` confirmed the existing smoke QA account has Park `senior_manager` as default and no Maysternya or CRM membership. Exact IDs and the source profile are in the private `ROLE_QA_PREFLIGHT_PRIVATE.json` outside Git (SHA-256 `82a25cb86f7f72a2d9843768138195946766567ce511c088b08c5a859e96977f`). The proposed QA creates at most two target membership rows, cycles manager/admin/animator one business at a time, and deactivates each through the organization API. Inactive rows and audit records remain; no write has occurred. `AGENTS.md` requires a separate exact Red approval for role changes. Observation still has `startUtc=null`.

## Current telemetry access update

The owner separately approved `SYS-MB-CLOSE-03-TELEMETRY-READ-20260922`. Exact 15-column SELECT on the two durable telemetry tables is active for the dedicated read-only role; the collector ran successfully and the private ACL receipt is stored outside Git. See [TELEMETRY_READ_GRANT_REPORT.md](TELEMETRY_READ_GRANT_REPORT.md). `startUtc` remains null because required live role/revoke QA, longest enabled cycle and full entry-family coverage are not yet proven. The existing monitor must use this current handoff and eventually track the exact revoke; do not repeat the grant.

## Current update: SYS-MB-ASSET-CLOSE-02 applied

The exact block `SYS-MB-ASSET-CLOSE-02-20260922` was approved and executed. Four `image_url` fields are now `null`; versions and history advanced; all nine catalog owners, statuses and three public tokens remained unchanged. Existing viewers passed 18 browser combinations with no old-image request or image failure. The journal receipt matched and its temporary SELECT lease was revoked in 0.431 seconds. No code deploy was needed; live SHA remains `ac6efaeb85b238f3eeb1cac7c9e0e8c5d024fe79 / v0.82.11`. The exact report is [ASSET_CLOSE_02_REPORT.md](ASSET_CLOSE_02_REPORT.md).

Do not rerun `apply`: source hashes and versions have intentionally changed. The forward rollback in `ASSET_REPAIR_ROLLBACK.md` remains available only under the approved block and matching current-value predicates.

Next: obtain a separate narrow read-only access block for the two durable telemetry tables, determine the longest enabled cycle, and finish live role/revoke acceptance with existing approved test sessions or a separately authorized fixture lifecycle. The booking 403s were classified as correct CRM timeline denials; the unnecessary shared-sidebar requests are an isolated P2 follow-up. `OBSERVATION_START.md` remains unset and the existing monitor must not count elapsed time yet. The older checkpoint below is retained as preparation history.

## Current checkpoint

- Worktree: `C:\Users\Plotva\OneDrive\Документи\EventGenix\.worktrees\sys-mb-asset-close-01-20260922`
- Branch: `codex/sys-mb-asset-close-01-20260922`
- Base: `ac6efaeb85b238f3eeb1cac7c9e0e8c5d024fe79`
- Live: `ac6efaeb85b238f3eeb1cac7c9e0e8c5d024fe79 / v0.82.11`
- Accepted SYS-MB ancestor: `9822db02e748b451ec0a937071057a8aac802cac / v0.82.10`
- Mapping SHA-256: `4040295a1fdc2cc7067ce8f9299c7b6cd6270c38d1633d19d8ddbe7de927844b`
- Source fingerprint: `eb8d1cf62ed2af95a35b8c9025d0604352016b0ba5b46b511fb8e8d1c2085f1d`
- Production mutation: none.

The seven local post-QA CLOSE-02 reports were carried by patch onto the current production base. Tasker/My Day and all other production-branch commits remain intact.

## Finding

No content-identical durable replacement exists for the four broken fields. Do not select any of the nine contextual Cakes blobs: they are unowned legacy item assets with other consumers and no page identity evidence.

The prepared recommendation is to clear exactly four broken `image_url` fields to `null`, retaining the existing page content and no-image fallback. This is a business/content mutation and remains blocked until the exact `SYS-MB-ASSET-CLOSE-02-20260922` block is approved.

## Private evidence

Private directory, never copy to Git:

`C:\Users\Plotva\.eventgenix\sys-mb-asset-close-01-20260922`

It contains the exact URLs/tokens/mapping and read-only inspection outputs. The authoritative private mapping filename is `ASSET_REPAIR_MAPPING_PRIVATE.json`. Before apply, set its approval metadata to the exact approved block ID without changing the hashed `mapping` object; the mapping hash must remain unchanged.

## Next execution

1. Re-fetch `origin/codex/eventgenix-production` and recheck live `/api/version`.
2. Run controller `prepare`; any current-value/page-version drift invalidates this package.
3. Obtain the exact block copied from `ASSET_REPAIR_MANIFEST.md`.
4. Apply through the four existing API paths only.
5. Run controller `verify`, private public-viewer verification and browser/network QA.
6. Confirm zero fixtures and no new jobs/assets/tokens.
7. Start measured observation only after complete PASS, then update the existing monitor instead of creating a duplicate.

If the owner rejects the no-image fallback, stop. Collect four reviewed image files and rebuild the mapping with content hashes, MIME, size, event_genix ownership and consumer proof; do not reuse contextual blobs by filename.
