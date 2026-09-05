# R3 Redirect Handoff — 2026-09-05

Base SHA for this R2 worktree: `8b5849e7e228358afcc5800fb4da1e7ebf28df95` (`origin/codex/eventgenix-production`, detached worktree `.codex-temp/r1-redirect-gate-20260905`). Main dirty checkout was not touched.

## Current gate

R2 auth/session local acceptance is now clear. Proceed to R3 only for rate-limit/request-budget behavior. Do not reopen R2 auth/session unless a focused new R2 regression appears.

## R2 factual status

Implemented locally:

- bounded backend recovery with exact signed same-session proof via JWT `sessionTokenId`;
- no UA/IP-only recovery;
- terminal logout/revocation guard for predecessor recovery;
- connected refresh-token chain during recovery (`T0 -> T1 -> T2`);
- cross-session same-account proof is denied;
- same-fingerprint replay without signed proof remains hostile;
- frontend refresh application by server session order, not client timestamps;
- recovered response application in both response delivery orders and differing server arrival order;
- same-user metadata merge no longer marks a global auth transition unless identity/authorization changes;
- repaired disposable PostgreSQL/browser harness.

Verified locally:

- `npm run check:runtime` — PASS, Node 22.23.1 / npm 10.9.8.
- `node --test tests\redirect-auth-regression-gate.test.js tests\auth-api-session-hardening.test.js tests\auth-account-lifecycle.test.js` — 73/73 PASS.
- `npm run check:syntax` — 1078/1078 PASS.
- `git diff --check` for R2 files — PASS.

Verified with real disposable PostgreSQL/browser:

- `npx --yes --package playwright node scripts\run-isolated-postgres-tests.js redirect-auth` — PASS.
- A new PostgreSQL 16 Docker container was created with prefix `eventgenix-r2-redirect-pg-`, DB `eventgenix_r2_disposable_redirect`, loopback-only port binding, and label `eventgenix.r2.disposable=redirect-auth-20260905`.
- `TEST_DATABASE_URL`, JWT secret, bootstrap username, and bootstrap password were process-local and not printed.
- `DATABASE_URL` was cleared for the test process; no production DB fallback was used.
- Cleanup completed; no container remains with label `eventgenix.r2.disposable=redirect-auth-20260905`.

Browser/PostgreSQL proof covered:

1. Actual browser login through page runtime.
2. Committed rotation with lost response and post-grace same-session recovery.
3. Access tokens accepted by `/api/auth/verify`.
4. DB chain correctness and active recovered tail.
5. Next refresh after recovery.
6. Two-tab delayed refresh in both delivery orders.
7. Same-fingerprint replay without signed proof.
8. Predecessor replay after current-device logout.
9. Actual navigation across `/`, `/sales-funnel`, and `/certificates`.

## R3 scope reminder

R3 should focus only on rate-limit behavior from `tests/redirect-rate-limit-regression-gate.test.js` and related request-budget/global `/api` limiter logic.

Known R3 starting point from R1:

- Existing R1 rate-limit gate expected red: anonymous static/API pressure can make `/api/auth/verify` return `429` instead of the expected unauthenticated contract.
- Preserve R2 auth/session contracts while changing limiter behavior.

R4 remains Service Worker/offline redirect behavior; keep those tests out of R3 unless explicitly rescheduled.

No commit, push, deploy, production mutation, production secret, dependency manifest change, or DB migration was made during R2.
