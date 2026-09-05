# R6 Redirect Handoff — 2026-09-05

Worktree: `C:/Users/Plotva/OneDrive/Документи/EventGenix/.codex-temp/r1-redirect-gate-20260905`.
Base SHA: `8b5849e7e228358afcc5800fb4da1e7ebf28df95` (`origin/codex/eventgenix-production`, detached).
Main checkout was not modified. No commit, push, deploy, production mutation, production load, dependency change, schema change, migration, CI/config change, endpoint, third-party telemetry, or secrets/settings change was made.

## R6 local acceptance verdict

READY FOR RELEASE PREPARATION for local release-prep work only. This does not mean the issue is fixed on production.

R6 completed independent local acceptance of the current R1–R5 worktree changes. The remaining BLOCKED item is Playwright/WebKit-specific execution because the local workspace has no `playwright` or `@playwright/test` package and new dependencies were prohibited. The same redirect/SW/browser scenarios were covered with the available local Chrome CDP runtime.

## Evidence by category

### Unit / mock regression

PASS:

```powershell
node --test tests\redirect-diagnostics.test.js
node --test tests\auth-frontend-session.test.js
node --test tests\permission-bootstrap-lifecycle.test.js
node --test tests\auth-api-session-hardening.test.js tests\redirect-rate-limit-regression-gate.test.js tests\redirect-auth-regression-gate.test.js tests\auth-account-lifecycle.test.js tests\service-worker-redirect-regression-gate.test.js tests\service-worker-policy.test.js tests\redirect-diagnostics.test.js tests\auth-frontend-session.test.js tests\permission-bootstrap-lifecycle.test.js
npm test
```

Observed final focused R2–R5 suite: 180 pass, 0 fail.
Observed final `npm test`: pass; final UI smoke summary `Passed: 1310 / Failed: 0`.

Coverage included:

- lost/delayed refresh, two tabs, both response delivery orders, next refresh after recovery;
- logout/revocation/deactivation terminal behavior and hostile replay protection;
- old access tokens without `sessionTokenId` refreshing into a new token pair;
- same-user metadata merge without revoking a valid refresh response;
- business request budget isolated from verify/login/refresh availability;
- 429 machine-readable code, `Retry-After`, bounded retry, and retry-later behavior for `Retry-After: 60`;
- R4 neutral offline fallback instead of Timeline substitution;
- R5 redaction, route templates, controlled code/reason, bounds, expiry, dedup including tabId, storage/clipboard fail-open.

### Chrome CDP with stub API / synthetic lifecycle / real browser navigation

PASS:

```powershell
node tests\browser\redirect-regression-gate-browser-smoke.js
```

Runtime used: `C:\Program Files\Google\Chrome\Application\chrome.exe` through Chrome DevTools Protocol.

Coverage included:

- Timeline ↔ Leads ↔ Certificates through real sidebar click handling, not test-side `window.location.assign`;
- offline/reconnect on Certificates;
- Back/Forward browser navigation;
- synthetic `pageshow.persisted` and visibility resume lifecycle recovery for Leads and Certificates;
- stale tab Service Worker update with `controllerchange`, preserved route, preserved unsaved input, and no forced reload loop;
- diagnostics export bounded/redacted after controlled failures.

Real BFCache note: the CDP smoke records trusted Back/Forward navigation and separately exercises synthetic `pageshow.persisted`. It does not claim synthetic lifecycle is a real BFCache substitute.

### Real browser → Express → PostgreSQL

PASS:

```powershell
node scripts\run-isolated-postgres-tests.js redirect-auth
```

Execution details:

- A disposable local PostgreSQL 16 Docker container was created only for this run.
- `DATABASE_URL` was cleared for the process.
- `TEST_DATABASE_URL` and test credentials were process-local and not printed.
- The database name included the required disposable marker.
- `TEST_DATABASE_RESET_CONFIRM=RESET_DISPOSABLE_TEST_DATABASE` was set process-local.
- The runner cleaned up the owned container in `finally`.
- Because `playwright` was unavailable, `tests/browser/redirect-auth-postgres-browser-smoke.js` used the local Chrome CDP fallback.

Coverage included:

- server already committed refresh rotation but first browser response was lost;
- post-grace same-session recovery returns a new token pair that the server accepts;
- delayed two-tab refresh with `original-first` and `recovery-first` delivery orders;
- next refresh after recovery works;
- terminal hostile replay without signed proof stays rejected;
- predecessor replay after logout remains terminal and does not create replacement token rows;
- module navigation to Timeline, Leads, and Certificates keeps authenticated shell and server-accepted access token.

### Guard checks

PASS:

```powershell
node -v
npm -v
npm run check:runtime
npm run check:service-worker-policy
npm run check:access
npm run check:auth-boundary
npm run check:static-surface
npm run check:api-surface
npm run check:syntax
git diff --check
```

Observed runtime: Node 22.23.1 / npm 10.9.8.
`npm run check:runtime`: passed.
`npm run check:service-worker-policy`: passed, 2 cacheable API GETs, 28 sensitive prefixes, 0 offline mutation endpoints.
`npm run check:access`: passed, 26 roles, 43 page entries, 50 sidebar links.
`npm run check:auth-boundary`: passed, 39 public API exceptions, 12 integration contracts, 2 query-token exceptions.
`npm run check:static-surface`: passed, 42 root HTML files, 3 landing files, 8 legacy redirects.
`npm run check:api-surface`: passed, 90 route files, 91 direct route mounts, 1 nested route mount, 2 server-level API routes.
`npm run check:syntax`: passed 1079 files.
`git diff --check`: exit 0, CRLF warnings only.

### BLOCKED browser runtime

BLOCKED:

```powershell
node tests\browser\service-worker-browser-smoke.js
```

Reason: `Cannot find module 'playwright'`. Local checks also returned `playwright=MISSING` and `@playwright/test=MISSING`. No dependency installation was attempted because the task explicitly prohibited new dependencies. WebKit-specific coverage is unavailable in this workspace for the same reason.

## Current changed files

Product/runtime changes remain uncommitted in:

- `js/api.js`
- `js/auth.js`
- `js/components/sidebar.js`
- `middleware/auth.js`
- `middleware/rateLimit.js`
- `routes/auth.js`
- `server.js`
- `sw.js`

Test/handoff changes remain uncommitted in:

- `scripts/run-isolated-postgres-tests.js`
- `tests/auth-account-lifecycle.test.js`
- `tests/auth-api-session-hardening.test.js`
- `tests/auth-frontend-session.test.js`
- `tests/permission-bootstrap-lifecycle.test.js`
- `tests/service-worker-policy.test.js`
- `tests/browser/service-worker-browser-smoke.js`
- `tests/browser/redirect-auth-postgres-browser-smoke.js`
- `tests/browser/redirect-regression-gate-browser-smoke.js`
- `tests/redirect-auth-regression-gate.test.js`
- `tests/redirect-diagnostics.test.js`
- `tests/redirect-rate-limit-regression-gate.test.js`
- `tests/service-worker-redirect-regression-gate.test.js`
- `docs/R2_REDIRECT_HANDOFF_2026-09-05.md`
- `docs/R3_REDIRECT_HANDOFF_2026-09-05.md`
- `docs/R4_REDIRECT_HANDOFF_2026-09-05.md`
- `docs/R5_REDIRECT_HANDOFF_2026-09-05.md`
- `docs/R6_REDIRECT_HANDOFF_2026-09-05.md`

## Remaining risks

- No live-site QA was performed by request. Production is unchanged until commit/review/release/deploy/live QA happen later.
- Playwright/WebKit-specific smoke is blocked locally by missing packages; Chrome CDP coverage passed with the available runtime.
- Device-specific incidents can still depend on real browser BFCache behavior, storage partitioning, extensions, old tabs with very stale assets, OS memory pressure, or network transitions that synthetic tests cannot fully reproduce.
- Diagnostics are local-only; operators must copy/export diagnostics before clearing cache/storage.

## Post-release device checklist for R7/live QA

Run this only after a reviewed release is deployed. Save diagnostics before clearing cache/storage.

1. Laptop Chrome/Edge: open two tabs, log in, move Timeline → Leads → Certificates through sidebar clicks, use Back/Forward, background/foreground the tab, then export diagnostics.
2. Phone browser: log in, move Timeline → Leads → Certificates, background the browser, switch network/offline/online, return to the tab, then export diagnostics.
3. Old-tab update: keep an authenticated tab open during deployment, type unsaved text in a safe local field, wait for the new SW/controller, navigate between modules, confirm route and input remain.
4. Auth stress: in safe test account only, exercise refresh continuity from two tabs and confirm logout ends the session terminally.
5. If a redirect occurs, copy diagnostics first, then capture exact route, browser/device, time, and whether the tab was restored from background or old SW state.

## Recommended next step

Prepare the release branch/package for review using this worktree, then run CI and targeted live-site QA under a separate explicit release/deploy task.
