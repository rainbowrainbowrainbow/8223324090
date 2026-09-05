# R2 redirect/session handoff — 2026-09-05

Worktree: `C:/Users/Plotva/OneDrive/Документи/EventGenix/.codex-temp/r1-redirect-gate-20260905`.
Base SHA: `8b5849e7e228358afcc5800fb4da1e7ebf28df95` (`origin/codex/eventgenix-production`, detached).
Main checkout was not modified. No commit, push, deploy, production mutation, production secret, dependency manifest change, or DB migration was made.

## Current acceptance status

R2 local acceptance is complete for auth/session scope. B1-B4 and C1-C3 are repaired and verified, including a real browser → Express → PostgreSQL proof against a new disposable PostgreSQL 16 Docker container. The container was removed after the run and no R2 disposable container remains.

## Recovery contract implemented

- Backend recovery is bounded to the rotation-loss window: post-grace duplicate refresh can recover only within 30 seconds and only with a signed access-token proof from the same refresh-token row/session.
- `sessionTokenId` is embedded in access JWTs and returned in login/refresh responses. Recovery proof now requires exact `sessionTokenId === old refresh_tokens.id`; timestamp proximity is no longer accepted as same-session proof.
- UA/IP is retained as request metadata but is not sufficient proof of client ownership.
- A current-device logout or terminal revocation of the replacement-chain tail blocks predecessor recovery.
- Recovery preserves the token chain (`T0 -> T1 -> T2`) and revokes unreachable replacements, so logout/revocation from `T1` reaches recovered `T2`.
- Frontend stores `pzp_auth_session_token_id` and applies stale/recovered refresh responses by server session order, not by client `Date.now()` order.
- A newer server rotation cannot be overwritten by an older delivered response, including tied client timestamps.
- Hostile replay, cross-session proof, different account identity, missing signed proof, deactivation, revocation, logout-all, and current-device logout remain terminal.
- Same-user metadata merge no longer creates a global auth transition unless identity or authorization fields change.

Legacy note: access tokens minted before this change do not contain `sessionTokenId`, so they cannot use post-grace recovery after an already-committed rotation. Normal active refresh-token rotation and the existing duplicate grace path are unchanged.

## C1-C3 results

### C1 — client time was used as server order

Fixed. Frontend no longer uses `operationStartedAt < lastAppliedAt` as the decisive order. Successful refresh responses carry `sessionTokenId`; if storage already moved away from the request refresh token, the response may apply only when its server `sessionTokenId` is newer than the stored session id and identity/session generation still match.

Covered by `tests/redirect-auth-regression-gate.test.js`:

- later server recovery applies even when its client operation started earlier;
- older server rotation cannot overwrite newer storage when client timestamps tie;
- both response delivery orders still converge on the active recovered token.

### C2 — signed proof was not bound to one concrete session

Fixed. Recovery proof now verifies exact JWT `sessionTokenId` against the old refresh-token row id. Same-account access tokens from another session are rejected as hostile reuse.

Covered by `tests/auth-account-lifecycle.test.js`:

- post-grace recovery rejects signed access proof from a different session of the same account;
- same-fingerprint replay without signed proof remains hostile;
- logout/revocation and replacement-chain protection remain intact.

Saved reproduction result after fix:

```text
reproduce-cross-session-access-proof.cjs: 401 !== 200
```

This is expected because the old defect assertion expected recovery to succeed.

### C3 — browser harness runtime/acceptance errors

Fixed and executed. The harness now:

- uses `APIResponse.headers()` instead of `allHeaders()`;
- separates expected fault events from unexpected `pageerror`/console errors;
- verifies logout/replay by specific chain and baseline counts, not by requiring zero active sessions for the whole user;
- accepts both `mainApp` shell and standalone `main-content` shell, then checks page-specific DOM module markers;
- verifies actual navigation across `/`, `/sales-funnel`, and `/certificates`.

## Verification performed

Passed:

```powershell
node --check middleware\auth.js
node --check routes\auth.js
node --check js\api.js
node --check tests\redirect-auth-regression-gate.test.js
node --check tests\auth-account-lifecycle.test.js
node --check tests\browser\redirect-auth-postgres-browser-smoke.js
npm run check:runtime
node --test tests\redirect-auth-regression-gate.test.js tests\auth-api-session-hardening.test.js tests\auth-account-lifecycle.test.js
npm run check:syntax
```

Results:

- Runtime baseline: Node 22.23.1 / npm 10.9.8.
- Targeted R2 Node tests: 73/73 passed.
- Syntax check: 1078/1078 files passed.
- `git diff --check` for R2 files: passed.

Real disposable PostgreSQL/browser proof:

```powershell
npx --yes --package playwright node scripts\run-isolated-postgres-tests.js redirect-auth
```

Run details:

- New PostgreSQL 16 Docker container with name prefix `eventgenix-r2-redirect-pg-` and label `eventgenix.r2.disposable=redirect-auth-20260905`.
- DB name: `eventgenix_r2_disposable_redirect`.
- Port bound only on `127.0.0.1`.
- `TEST_DATABASE_URL`, JWT secret, bootstrap username, and bootstrap password were process-local and not printed.
- `DATABASE_URL` was cleared for the test process; no production DB fallback was used.
- Runner reset only the disposable public schema and generated disposable test credentials.
- PASS output: `[redirect-auth-browser] R2 PostgreSQL/browser auth recovery proof passed` and `[r2-proof] redirect-auth isolated PostgreSQL/browser proof passed`.
- Cleanup output: `[r2-proof] disposable postgres container removed: ...`.
- Final Docker check: no containers remain with label `eventgenix.r2.disposable=redirect-auth-20260905`.

The proof covers:

1. Browser login through actual page runtime, not Node login.
2. Server commits refresh rotation, browser loses the response, post-grace same-session retry recovers a new pair.
3. Stored access token is accepted by `/api/auth/verify`.
4. DB chain is connected and correct: root `T0` revoked, lost `T1` revoked, `T0 -> T1 -> T2`, recovered `T2` active.
5. Next refresh after recovery succeeds and server accepts the new stored access token.
6. Two browser tabs with delayed refresh responses in both delivery orders converge on recovered `T2`.
7. Same-browser UA/IP replay without signed proof returns hostile reuse.
8. Predecessor replay after current-device logout is terminal and does not create a replacement row/session.
9. Actual navigation across `/`, `/sales-funnel`, and `/certificates` keeps auth storage, hides login UI, shows an authenticated shell, and renders the expected module DOM.

## Files changed in R2 scope

- `js/api.js`
- `middleware/auth.js`
- `routes/auth.js`
- `tests/redirect-auth-regression-gate.test.js`
- `tests/auth-api-session-hardening.test.js`
- `tests/auth-account-lifecycle.test.js`
- `tests/browser/redirect-auth-postgres-browser-smoke.js`
- `scripts/run-isolated-postgres-tests.js`
- `docs/R2_REDIRECT_HANDOFF_2026-09-05.md`
- `docs/R3_REDIRECT_HANDOFF_2026-09-05.md`

Pre-existing R1 files remain in the same worktree and were not cleaned up.

## Remaining risks

- R2 was verified locally and against disposable PostgreSQL/browser only; no production deploy or live-site mutation was performed.
- Physical multi-device/mobile-network changes were not tested; browser tabs and same-origin contexts were tested.
- R3 rate-limit and R4 Service Worker findings remain intentionally out of scope for this R2 continuation.

## Handoff gate before R3

R2 auth/session gate is clear locally. R3 may start on rate-limit behavior only, beginning from `tests/redirect-rate-limit-regression-gate.test.js`. Do not reopen R2 auth/session unless a new focused R2 regression is found.
