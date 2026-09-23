# SYS-MB organization creation — exact release candidate

Status: `PREPARED / NOT AUTHORIZED / NOT RELEASED`.

## Identity and scope

- Source: isolated `codex/sys-mb-org-release-20260923` worktree at `C:\Users\Plotva\OneDrive\Документи\EventGenix\.worktrees\sys-mb-org-release-20260923`.
- Production base, remote branch, and live SHA confirmed read-only on 2026-09-23: `ac6efaeb85b238f3eeb1cac7c9e0e8c5d024fe79`, `codex/eventgenix-production`, `v0.82.11 — Tasker + My Day UX`.
- Target: Railway project `fortunate-appreciation`, environment `production`, service `8223324090`, domain `https://8223324090-production.up.railway.app`.
- Commits before this documentation: `51fc69ac34467a50e90655bef2aaf383cc6d2ea2` (previous SYS-MB evidence), `466a7219fee6cdcd9263aad629a1a38565511785` (functional), `eecfd316cef8e7ec1d979e445372c53610ab4321` (canonical `v0.82.12` release markers). The exact final candidate SHA is the HEAD after this documentation is committed; record it in the external authorization, not recursively inside this file.
- Functional paths: `services/organizationLifecycle.js`, `routes/organizations.js`, `middleware/auth.js`, `js/business-cabinet-manager.js`, `package.json` (test script), `tests/organization-create.test.js`, `tests/business-cabinet-manager.test.js`, `tests/business-membership-security.test.js`, `tests/integration/organization-lifecycle-postgres.test.js`.
- Documentation paths: the prior SYS-MB evidence checkpoint and this folder. The version commit changes `package.json`, `package-lock.json`, `CHANGELOG.md`, `index.html`, and generated first-screen/asset cache markers across the existing static files. These are version-only changes; no global menu/router/theme behavior change.
- Migration delta from live to candidate: **none**. No schema, seed, data-fix, cleanup, dependency, secret, hosting-setting, payment, pricing or formula change.
- Read-only owner/QA-account preflight passed on the live base without a fixture: private receipt SHA-256 `a72d362dd61f4665c34ba26f08c27a3e9b5a71215cac5c0f91173b53211e6eab`. The current creator credential also has the verified active organization owner membership. Refresh this preflight before any live QA write.

## Gates before production push

1. Refresh `/api/version`, `origin/codex/eventgenix-production`, and Railway status. Require the candidate to descend from the then-current production branch; if remote drifts, integrate without reset/force-push, rerun focused checks, and obtain a new exact SHA envelope.
2. Run the checked-in Express→PostgreSQL lifecycle test against an **owned disposable** local/CI PostgreSQL database if one is available. Its production-URL guard rejects a remote or production-like database. The current local result is **SKIP**, not PASS, because no such database is available and Docker is unavailable. Do not turn CI's unrelated PostgreSQL jobs into evidence for this case. If release proceeds under an exact block, the registered post-deploy lifecycle QA below is the mandatory actual-PostgreSQL verification; a failure triggers HOLD and scoped forward repair/rollback.
3. Recheck whole diff and `npm test` for the exact candidate; verify no new Red path or migration appears.
4. Obtain one current explicit **Red auth + Yellow release + exact QA fixture/cleanup** block for the final candidate, target, data predicates, ≤6 hours and ≤3 release attempts. The approval must acknowledge the skipped disposable PostgreSQL case and require live lifecycle QA on the deployed exact SHA. Earlier local and September production blocks do not apply.

## Authorized ordering only after gates and exact block

Push the exact approved SHA to `codex/eventgenix-production`; wait for every required GitHub CI check on that SHA; deploy through `npm run release:railway-up` with `RELEASE_DEPLOY_BRANCH=codex/eventgenix-production`. Never run raw `railway up`. Verify live `/api/version` exact SHA, branch, `0.82.12`, label. Record CI URL, Railway deployment ID, previous live SHA and version proof. Then run read-only owner/admin/worker checks and only the separately registered fixture lifecycle in [QA_FIXTURE_AND_CLEANUP.md](QA_FIXTURE_AND_CLEANUP.md). A fixture mismatch stops mutations, not the safe read-only checks.

## Rollback and HOLD rules

Previous verified live SHA: `ac6efaeb85b238f3eeb1cac7c9e0e8c5d024fe79`. Code rollback is a fresh exact-SHA helper deployment inside the active authorization, with live-version proof. It does **not** delete or reverse organizations created under the new endpoint. First reconcile and clean registered QA fixtures under their exact predicates; if any organization acquired real data or a non-QA membership, stop deletion and prepare a forward repair. Do not reactivate old operational grants or reset another workstream.

The functional release may be live while `GLOBAL_MODEL_COMPLETE=false`. Final fallback removal is blocked until the separate measured compatibility exit gate passes; this release does not assert `PASS_MEASURED` or change `observation.startUtc`.
