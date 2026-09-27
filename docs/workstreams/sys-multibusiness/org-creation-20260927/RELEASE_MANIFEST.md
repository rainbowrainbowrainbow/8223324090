# Organization creation: refreshed production candidate

Status: PREPARED / NOT PUSHED / NOT DEPLOYED. The 2026-09-23 candidate and authorization are superseded by production-branch drift and the six-hour envelope limit in `docs/CODEX_PRODUCTION_AUTONOMY.md`.

## Identity

- Isolated worktree: `C:\Users\Plotva\.codex\worktrees\sys-mb-org-release-refresh-20260927\EventGenix` on `codex/sys-mb-org-release-refresh-20260927`.
- Current production branch base: `3df8ddaad24baba86fe10bbc52afde46abd2a93e`. Live before release: `acbd1f62ed51ce16b6b0469023f4225c8bef6d7a`, `codex/eventgenix-production`, `v0.82.21 — Сертифікати: коректне прострочення`. The two remote commits ahead of live alter certificate documentation only.
- Target: Railway project `fortunate-appreciation` (`bc28b46c-d4bc-491c-893a-d8401c633668`), environment `production`, service `8223324090` (`3fb62d4c-2dc2-4701-8e2b-09ce16e188ee`), domain `https://8223324090-production.up.railway.app`.
- Functional commit: `8037f816f21a485ec5fc3c6b62532d0773cc70f8`. Separate version/cache/changelog commit: `d05684cedb0249b6ad3af62be3238b094c43ca64` (`v0.82.22 — Організації: створення власником`). The exact candidate SHA is the final HEAD after this documentation commit and must be named in the authorization.
- Functional files: `services/organizationLifecycle.js`, `routes/organizations.js`, `middleware/auth.js`, `js/business-cabinet-manager.js`, `package.json` (test script), `tests/organization-create.test.js`, `tests/business-cabinet-manager.test.js`, `tests/business-membership-security.test.js`, `tests/integration/organization-lifecycle-postgres.test.js`. The candidate also contains the prior SYS-MB evidence checkpoint, this release documentation, and canonical version-only cache/changelog files.
- New migrations: none. No schema, price, formula, payment, HR, secret, hosting setting or dependency change. No existing organization, business, membership or default is modified by the new create path.

## Verified gates

- Node 22.23.1 / npm 10.9.8; `npm run test:unit:business-cabinets` PASS 90/90; `npm test` PASS exit 0; `npm run check:version` and `git diff --check` PASS after the docs-only rebase.
- Checked-in actual Express→PostgreSQL lifecycle test remains SKIPPED: no owned disposable PostgreSQL URL was available. CI's unrelated PostgreSQL jobs do not substitute for this case. Exact live lifecycle QA must remain a release acceptance gate.
- Fresh live read-only owner preflight PASS on live `acbd1f62...`: one source organization, four businesses, one active owner candidate matching the test creator, one smoke QA account, zero QA rows created. Private receipt SHA-256: `5766d3ac77598a15ee3b340f9c99c821349d508618145872c6563ce16b9dabf4`; private identities and credentials remain outside Git.
- Railway explicit-project read-only status confirmed the target, domain and successful current deployment. The worktree itself is intentionally unlinked; the helper supplies the project ID explicitly.

## Required release sequence

Refresh live `/api/version`, remote branch, Railway target and `git merge-base` immediately before push. Any production runtime/version drift invalidates this candidate and its exact block. Obtain a current Red auth + Yellow production push/deploy envelope for the final SHA, up to six hours and three attempts. Push only the exact approved SHA to `codex/eventgenix-production`; require green CI on that SHA; deploy with `RELEASE_DEPLOY_BRANCH=codex/eventgenix-production npm run release:railway-up`; prove live exact SHA, branch, version and label. No raw `railway up` or force-push.

Then perform safe owner/admin/worker read-only QA. A two-organization write-QA fixture may run only under an additional exact data/cleanup authorization that includes the registry, private predicates and guarded cleanup in [QA_FIXTURE_AND_CLEANUP.md](QA_FIXTURE_AND_CLEANUP.md). If that is unavailable, mark two-organization live creation NOT_TESTABLE; do not leave an uncleanable production fixture.

## Rollback

Previous live SHA is `acbd1f62ed51ce16b6b0469023f4225c8bef6d7a`. A code rollback is a fresh exact-SHA helper deployment under the active block, followed by live proof. It cannot erase an organization created under the endpoint. Do not restore legacy operational grants. For any QA-created rows, run only the separately approved guarded cleanup or stop for forward repair if predicates drift.

This release does not start the compatibility observation window or assert `PASS_MEASURED` / `GLOBAL_MODEL_COMPLETE`.
