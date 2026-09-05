# R4 Redirect Handoff — 2026-09-05

Worktree: `C:/Users/Plotva/OneDrive/Документи/EventGenix/.codex-temp/r1-redirect-gate-20260905`.
Base SHA: `8b5849e7e228358afcc5800fb4da1e7ebf28df95` (`origin/codex/eventgenix-production`, detached).
Main checkout was not modified. No commit, push, deploy, production mutation, production load, dependency change, schema change, migration, CI/config change, or secrets/settings change was made.

## R4 status

R4 local acceptance is green after the 2026-09-05 follow-up. The remaining lifecycle gap for Leads was closed without reopening R2/R3 auth/session semantics.

## What changed in R4

- `js/components/sidebar.js`
  - `_isAuthenticatedShellVisible()` now supports existing authenticated shell containers, including `#mainApp`, `#main-content`, `.page-container`, and `.main-content`.
  - Shell recovery remains gated by authenticated shell state and excludes `auth-screen`, so hidden protected content is not shown before authorization or after logout.
  - `pageshow.persisted` and visible `visibilitychange` recovery clear `page-exiting`, `shell-baseline`, and `aria-busy` for Leads and Certificates.
  - Sidebar transition navigation now has an idempotent `requestAnimationFrame` + bounded `setTimeout` fallback so a click cannot leave the page stuck in `page-exiting` if the animation frame does not run.
- `sw.js`
  - Non-root module navigation without an exact cached page returns neutral offline retry HTML with status 503 and preserves the requested route on the page.
  - `/` and `/index.html` remain the only routes allowed to use the cached index shell as an offline navigation fallback.
  - Timeline shell is not used as an offline fallback for Leads/Certificates.
- `tests/service-worker-policy.test.js`
  - Updated the old offline fallback expectation from `200 index shell for module route` to `503 neutral offline page for module route`.
  - Added root/index-only shell fallback coverage.
- `tests/browser/redirect-regression-gate-browser-smoke.js`
  - Browser navigation now goes through a real sidebar anchor click path, not `window.location.assign(link.href)` from the test.
  - Verifies Leads and Certificates Back/Forward, real trusted `pageshow` evidence, synthetic `pageshow.persisted`, synthetic visibility resume, `page-exiting`, `aria-busy`, visible shell, offline/reconnect, route preservation, hidden shell recovery, and no Timeline substitution.
  - SW update proof now checks new revision activation, `controllerchange` in stale tabs, route preservation, and unsaved input retention without forced reload.
  - Test SW source rewrites cache constants by regex, not by hardcoded `0.81.73` byte replacement.
- `tests/browser/service-worker-browser-smoke.js`
  - Existing Playwright smoke was strengthened to verify controllerchange/new cache/old cache removal and to rewrite SW cache constants by regex.
  - Local execution is blocked because `playwright` is not installed and this task forbids new dependencies.

## Verified checks

Passed locally:

```powershell
node tests/service-worker-policy.test.js
node --test tests\service-worker-redirect-regression-gate.test.js
node tests\browser\redirect-regression-gate-browser-smoke.js
node --test tests\auth-api-session-hardening.test.js tests\redirect-rate-limit-regression-gate.test.js tests\redirect-auth-regression-gate.test.js tests\auth-account-lifecycle.test.js tests\service-worker-redirect-regression-gate.test.js tests\service-worker-policy.test.js
```

Final combined Node suite after R5 also passed:

```powershell
node --test tests\auth-api-session-hardening.test.js tests\redirect-rate-limit-regression-gate.test.js tests\redirect-auth-regression-gate.test.js tests\auth-account-lifecycle.test.js tests\service-worker-redirect-regression-gate.test.js tests\service-worker-policy.test.js tests\redirect-diagnostics.test.js
```

Observed final result: 99 pass, 0 fail.

Additional guards passed:

```powershell
npm run check:runtime
npm run check:service-worker-policy
npm run check:auth-boundary
npm run check:api-surface
npm run check:static-surface
npm run check:syntax
git diff --check
```

`npm run check:syntax` required escalation because the sandbox blocked internal `node` `spawnSync` calls with `EPERM`. `git diff --check` returned code 0 with only existing CRLF warnings.

## Known local limitation

```powershell
node tests\browser\service-worker-browser-smoke.js
```

was not executed to PASS because local `playwright` is not installed. No dependency was installed per task constraints. The Chrome CDP smoke covers the R4 scenarios requested in this task.
