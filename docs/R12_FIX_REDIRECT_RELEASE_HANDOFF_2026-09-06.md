# R12-FIX redirect release handoff — 2026-09-06

Scope: narrow frontend refresh handling fix for repeated recoverable duplicate refresh conflicts, plus proof harness corrections. Backend replay/recovery contract, permissions, Service Worker product logic, schema, CI config, secrets, production data, push to production, and deploy were not changed.

Base candidate before this fix: `155bb63aa19232a2b384aa235daa2838ea452c6f` on `codex/redirect-watchdog-oldtab-release-r12`.

## Confirmed regression before fix

Deterministic VM regression was added first and run against the starting candidate. It failed as expected:

```text
node --test tests/auth-frontend-session.test.js --test-name-pattern "repeated duplicate rotation"
not ok - apiRefreshAuthSession treats repeated duplicate rotation as retry-later without access-only settlement
access-token-only storage events must not trigger early replay
2 !== 1
```

Reproduction sequence:

1. First refresh returns HTTP `409` with `code=refresh_already_rotated`.
2. After 100 ms, another tab publishes an access-token-only storage event without changing refresh token or session generation.
3. Old code accepted that access-only event as refresh settlement.
4. At 250 ms it performed an early replay with the old refresh token.
5. A second `409 refresh_already_rotated` was classified as terminal and cleared auth storage.

## Fix

Changed `js/api.js` so:

- refresh settlement and refresh coordination only settle on refresh-token/session-generation changes, not access-token-only storage events;
- repeated `409 refresh_already_rotated` returns bounded `retry-later` with a transient auth-session failure;
- current session storage is preserved;
- no success is returned without a usable access token;
- terminal `401`/revoked/inactive/reuse paths remain terminal.

## Harness corrections

- `tests/auth-frontend-session.test.js`: added controlled timers, storage-event dispatch, and diagnostics sink for the duplicate409 regression.
- `tests/browser/redirect-auth-postgres-browser-smoke.js`: added redacted timing/proof evidence for delayed two-tab refresh assertions; no tokens are logged.
- `tests/browser/redirect-old-tab-upgrade-browser-smoke.js`: added unsaved-input precondition evidence with document ID, proof ID, `isConnected`, value, and trace before SW update. A changed document before SW update is now `PRECONDITION_FAILED`, not “SW lost input”. Also tightened module bootstrap wait to require the target route, non-loading document, and loaded auth API.

## Verification before commit

PASS:

```text
node --test tests/auth-frontend-session.test.js --test-name-pattern "repeated duplicate rotation|refresh is rejected|terminal|logout|account|success returns|object argument"
# pass 69, fail 0

node --test tests/auth-frontend-session.test.js tests/auth-api-session-hardening.test.js tests/redirect-auth-regression-gate.test.js tests/redirect-rate-limit-regression-gate.test.js tests/service-worker-redirect-regression-gate.test.js tests/redirect-diagnostics.test.js tests/redirect-postrelease-risk-reproductions.test.js tests/service-worker-policy.test.js
# pass 156, fail 0

node scripts/run-isolated-postgres-tests.js redirect-auth
# R2 PostgreSQL/browser auth recovery proof passed

node scripts/run-isolated-postgres-tests.js redirect-upgrade
# status PASS; proofPath output/browser/redirect-old-tab-upgrade/r11-old-tab-upgrade-proof.json; failures []
```

Disposable PostgreSQL containers were created only for these local proofs and removed by the wrapper. `DATABASE_URL` was cleared process-locally; `TEST_DATABASE_URL` pointed only at the disposable local container.

## Evidence notes

- The first Docker wrapper attempt hit a PostgreSQL init/restart readiness race and is infrastructure, not product evidence. The wrapper was corrected to wait for stable SQL readiness.
- An early `redirect-auth` run produced a timing-sensitive delayed two-tab assertion and secondary CDP teardown timeout. Re-run with redacted proof instrumentation passed.
- The released old-tab cohort initially failed before SW update because the harness accepted a transient navigation state. Tightened bootstrap wait fixed this; the repeated `redirect-upgrade` run passed.
- `redirect-upgrade` final dirty-candidate proof observed real BFCache: `realBfcachePersisted: true`.
- Candidate asset hashes in the dirty proof are recorded in `output/browser/redirect-old-tab-upgrade/r11-old-tab-upgrade-proof.json`.

## Additional R12-FIX correction after dirty proof

The first exact-candidate PostgreSQL proof after commit `a2f3e6e47eec6a5dcaed6ca53c95563a4bc16eb6` exposed a second frontend issue in the two-tab delayed refresh scenario:

```text
node scripts/run-isolated-postgres-tests.js redirect-auth
AssertionError: second old-token response must be duplicate-grace or recovered
status=401 code=refresh_token_reuse elapsedFromFirstCommitMs=5235
```

Root cause: when another tab owned the same refresh coordination marker, the waiting tab timed out after the frontend coordination budget and then sent the original refresh token. That could cross the server duplicate-grace window and turn a recoverable concurrency case into terminal reuse.

Additional fix in `js/api.js`: if the coordination wait times out while the same refresh operation is still owned by another tab, the waiting tab now returns bounded `retry-later` with reason `refresh-coordination-timeout`, records redacted diagnostics, and does not send stale-token replay or clear auth storage.

Regression coverage was updated to keep the contracts separate:

- cross-tab coordination timeout: no stale network replay, session preserved, retry-later returned;
- duplicate grace: real Browser→Express→PostgreSQL request returns HTTP 409 `refresh_already_rotated` and does not create T2;
- post-grace recovery: real lost-response Browser→Express→PostgreSQL scenario still proves T0→T1→T2;
- delivery-order mock gates still cover original/recovered response order without depending on the foreign coordination marker.

Dirty proof after this correction passed:

```text
node --test tests/auth-frontend-session.test.js tests/auth-api-session-hardening.test.js tests/redirect-auth-regression-gate.test.js tests/redirect-rate-limit-regression-gate.test.js tests/service-worker-redirect-regression-gate.test.js tests/redirect-diagnostics.test.js tests/redirect-postrelease-risk-reproductions.test.js tests/service-worker-policy.test.js
# pass 156, fail 0

node scripts/run-isolated-postgres-tests.js redirect-auth
# R2 PostgreSQL/browser auth recovery proof passed

node scripts/run-isolated-postgres-tests.js redirect-upgrade
# status PASS; failures []; realBfcachePersisted true
```

This dirty proof used its own disposable local PostgreSQL 16 container and synthetic accounts only. The wrapper removed the container after completion.
## CI shallow-checkout fixture correction

Feature CI run `34043580969` for commit `6d8178f620731202d2daaa3e196a6fddcf63ff7e` failed only in the Fast baseline job. Other CI jobs passed. The failing step was `tests/redirect-postrelease-risk-reproductions.test.js` because the GitHub checkout is shallow (`fetch-depth: 1`) and the test tried to load `9ea61f1ea6c38b6f218bbc4b9ceda3f772bedbd5:js/api.js` with `git show`.

This was a test-fixture portability problem, not a product runtime failure. The test now uses the real historical blob when available and falls back in shallow CI to a compact modeled old-client fixture that preserves the specific R9 behavior being reproduced: a lost committed refresh response followed by post-grace terminal401 clearing in old frontend logic. The report records whether the source was `git-blob` or `modeled-fallback`.

Local verification after this fixture correction passed:

```text
node --check tests/redirect-postrelease-risk-reproductions.test.js
node --test tests/redirect-postrelease-risk-reproductions.test.js
# pass 4, fail 0

node --test tests/auth-frontend-session.test.js tests/auth-api-session-hardening.test.js tests/redirect-auth-regression-gate.test.js tests/redirect-rate-limit-regression-gate.test.js tests/service-worker-redirect-regression-gate.test.js tests/redirect-diagnostics.test.js tests/service-worker-policy.test.js
# pass 152, fail 0
```

Because this changes the candidate SHA, all exact-SHA local proofs and feature CI must be repeated after commit.
## Remaining risks

- R10B remains out of scope: post-rotation replay beyond the 30s backend recovery window can remain terminal under the current backend contract.
- Chrome CDP proof is not Safari/WebKit or physical mobile proof.
- Production live QA was not run in this block.
- Exact-SHA CI and exact release-artifact proof must be repeated after the local commit because the current proof was on a dirty worktree.

## Final exact-candidate verification after shallow-checkout correction

Final candidate code commit after the doc/test fixture correction: `b391a34a52334c8eb9520e07aba0b543ef5aa483`. This handoff-only update is documented separately and does not change product/runtime assets.

The previous Fast baseline CI failure on commit `6d8178f620731202d2daaa3e196a6fddcf63ff7e` was closed by `b391a34a52334c8eb9520e07aba0b543ef5aa483`, which keeps the full-history local proof on the real `9ea61f1e` historical blob and uses an explicit modeled old-client fixture only when CI checkout depth cannot contain that historical commit.

Exact local verification for commit `b391a34a52334c8eb9520e07aba0b543ef5aa483` passed before this handoff-only update:

```text
npm run check:runtime
# PASS: Node 22.23.1 / npm 10.9.8

npm run check:version
# PASS: v0.81.77 — Redirect Watchdog Old-Tab Recovery

npm run check:syntax
# PASS: JavaScript syntax check passed: 1082 files.

git diff --check
# PASS

node --test tests/auth-frontend-session.test.js tests/auth-api-session-hardening.test.js tests/redirect-auth-regression-gate.test.js tests/redirect-rate-limit-regression-gate.test.js tests/service-worker-redirect-regression-gate.test.js tests/redirect-diagnostics.test.js tests/redirect-postrelease-risk-reproductions.test.js tests/service-worker-policy.test.js
# PASS: tests 156, pass 156, fail 0

npm test
# PASS: full verify exited 0; UI smoke Passed 1310 / Failed 0

node scripts/run-isolated-postgres-tests.js redirect-auth
# PASS: R2 PostgreSQL/browser auth recovery proof passed

node scripts/run-isolated-postgres-tests.js redirect-upgrade
# PASS: status PASS, failures [], realBfcachePersisted true
```

The exact `redirect-upgrade` proof for `b391a34a52334c8eb9520e07aba0b543ef5aa483` recorded clean candidate asset hashes:

```json
{
  "dirtyPorcelain": "",
  "sw.js": "dea0fd4bb84db4fe7125c1b54e3c0a7bb2e27059c8a7420090ae6ec2f3207df8",
  "js/api.js": "55ae5906c6dbf0837317fb8ba765275b3425003ceb15309ee639b1d018d2a61e",
  "js/auth.js": "002988e628b71387bbceea3a1de4e9ac11c08d112f6fbf7caa0ff2f5ac311244",
  "js/components/sidebar.js": "e9bf38c47b209d350438e5cef2e4a99c2ef9c82d9abec77787f28e25ece158d7",
  "index.html": "0bf41186491ff50cde6cd4eb9d0cd9fe3f46001a886264cb78fd4dc628c7db3e",
  "leads.html": "a306a4ba248a361a7a62007245b0aad3541c9179cc32943cad6f2046cf706c4a",
  "certificates.html": "f519bfc968a4330cb275181d035cd651aadba4161fdca1029d6c0b5f3d6c2843"
}
```

Feature CI for `b391a34a52334c8eb9520e07aba0b543ef5aa483` passed: <https://github.com/rainbowrainbowrainbow/8223324090/actions/runs/34044608159>. Jobs green: Fast baseline, HR and payroll PostgreSQL integration, HR Team browser smoke, Checkbox park PostgreSQL mock integration, My Day browser interactions, My Day PostgreSQL integration.

Read-only production preflight at the time of this handoff: live `/api/version` reports `0.81.76` / `Redirect Reliability Release`, commit `d7aed2573d876c7051e96897a835343ed33573d5`, source branch `codex/eventgenix-production`, complete deployment manifest metadata. `origin/codex/eventgenix-production` is the same SHA and is an ancestor of the candidate.

No production push, deploy, production DB, production QA, schema/settings/secrets, or CI-config changes were performed.
