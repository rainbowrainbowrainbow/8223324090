# R5 Redirect Handoff — 2026-09-05

Worktree: `C:/Users/Plotva/OneDrive/Документи/EventGenix/.codex-temp/r1-redirect-gate-20260905`.
Base SHA: `8b5849e7e228358afcc5800fb4da1e7ebf28df95` (`origin/codex/eventgenix-production`, detached).
Main checkout was not modified. No commit, push, deploy, production mutation, production load, dependency change, schema change, migration, CI/config change, endpoint, third-party telemetry, or secrets/settings change was made.

## R5 status

R5 local acceptance is green after the final focused corrections. The diagnostic trail is local-only, bounded, redacted, deduped per tab, and fail-open. It does not change auth/session outcomes, retry budgets, Service Worker cache policy, or redirect destinations.

## Final focused reproductions added before fixing

`tests/redirect-diagnostics.test.js` now reproduces and protects:

- route redaction: `/customers/alice%40example.com` and `/customers/7` export as `/customers/:id`, not customer/email-like identifiers;
- controlled metadata: unknown `code` and arbitrary `reason` collapse to `unknown`;
- legacy/corrupt storage: export re-sanitizes structure, field allowlist, route redaction, expiry, entry count, and byte limits;
- SW offline writer: storage written by the neutral offline page is re-exported by runtime with the same safe contract;
- correlation: `swVersion` is either the active controller cache revision returned by `postMessage` or `unknown`, never `/sw.js`; dedup includes `tabId`.

Observed red state before the fix: the old runtime exported `/customers/alice-example.com`, retained `/customers/7`, allowed arbitrary reason text, merged events across tabs, reported `-sw.js`, and let the SW offline writer exceed storage bounds.

## What changed in R5

- `js/auth.js`
  - Added `installRedirectDiagnosticsRuntime(window)` and `window.RedirectDiagnostics`.
  - Stores local diagnostics under `pzp_redirect_diagnostics_v1` with a random per-tab id in `sessionStorage`.
  - Captures build version, active Service Worker controller revision or `unknown`, normalized route, visibility, lifecycle/bootstrap stage, HTTP status, allowlisted code/reason/requestId, refresh outcome, redirect reason, storage-clear reason, bounded retry-after seconds, and normalized target route.
  - Uses allowed modules/static route templates and replaces unknown dynamic segments with `:id`; unknown modules collapse to `/:unknown`.
  - Keeps hard bounds: max 80 entries, max 32768 stored JSON bytes, max 120 route chars, max 3 route segments, 24-hour expiry, and 2-second dedup window keyed by event/route/status/reason/code/stage/tabId.
  - Revalidates old stored entries during read/export.
  - Gets SW version through `navigator.serviceWorker.controller.postMessage({ type: 'redirect-diagnostics:get-version' })`; no HTTP polling.
  - Exposes `window.RedirectDiagnostics.export()` and `window.RedirectDiagnostics.copy()` for user/operator-initiated local export only.
  - Adds a transient auth recovery UI button: `Скопіювати діагностику`. The button does not send data anywhere.
- `js/api.js`
  - Records auth session failures, structured auth availability 429 details, refresh outcomes, terminal storage clears, requestId where response metadata already exposes it, and rate-limit retry-later state.
  - Added a JSON-read helper that uses `Response.clone()` when present and safely supports existing unit doubles without changing browser behavior.
  - Does not record tokens, Authorization headers, cookies, request/response bodies, passwords, localStorage dumps, or user/customer payloads.
- `js/components/sidebar.js`
  - Records sidebar navigation click, transition start, and shell lifecycle recovery using only normalized route metadata.
- `sw.js`
  - Neutral offline navigation page records a minimal local `sw-offline-navigation` diagnostic with normalized `location.pathname`, status 503, and SW cache name.
  - It does not copy raw `data-requested-route` into the journal.
  - Responds to `redirect-diagnostics:get-version` messages with the active `CACHE_NAME`.
- `tests/redirect-diagnostics.test.js`
  - Covers redaction/allowlist, route templates, controlled code/reason, size/entry/expiry bounds, dedup including tabId, storage/clipboard failure, active SW version correlation, and SW→storage→runtime export.
- `tests/auth-frontend-session.test.js` and `tests/permission-bootstrap-lifecycle.test.js`
  - Updated standalone extraction harnesses to model diagnostics as optional/fail-open.
- `tests/browser/redirect-regression-gate-browser-smoke.js`
  - Browser proof confirms diagnostics after real navigation/lifecycle/SW scenarios and checks the export does not contain test access token, refresh token, raw `data-requested-route`, query, or fragment markers.

## Verified checks

Passed locally on Node 22.23.1 / npm 10.9.8:

```powershell
node --test tests\redirect-diagnostics.test.js
node --test tests\auth-frontend-session.test.js
node --test tests\permission-bootstrap-lifecycle.test.js
node tests\browser\redirect-regression-gate-browser-smoke.js
node --test tests\auth-api-session-hardening.test.js tests\redirect-rate-limit-regression-gate.test.js tests\redirect-auth-regression-gate.test.js tests\auth-account-lifecycle.test.js tests\service-worker-redirect-regression-gate.test.js tests\service-worker-policy.test.js tests\redirect-diagnostics.test.js tests\auth-frontend-session.test.js tests\permission-bootstrap-lifecycle.test.js
npm test
npm run check:runtime
npm run check:service-worker-policy
npm run check:access
npm run check:auth-boundary
npm run check:static-surface
npm run check:api-surface
npm run check:syntax
git diff --check
```

Observed focused R2–R5 Node result after final fixes: 180 pass, 0 fail.
Observed `npm test` result after final fixes: pass, final UI smoke summary `Passed: 1310 / Failed: 0`.
`npm run check:syntax` passed 1079 files.
`git diff --check` returned code 0 with CRLF warnings only.

## Constraints preserved

- No tokens, JWTs, cookies, passwords, Authorization headers, user/customer data, response bodies, full localStorage, raw `data-requested-route`, endpoint, auto-send, third-party telemetry, or dependency added.
- Diagnostic failures are caught and do not block auth/navigation.
- R2 hostile replay, account isolation, logout/deactivation/revocation, R3 retry budgets, and R4 SW fallback contracts remained green in focused regression.

## Known limitation

`node tests\browser\service-worker-browser-smoke.js` remains BLOCKED locally because `playwright` is not installed. No dependency was installed by design. Equivalent redirect-gate browser coverage was executed through local Chrome CDP at `C:\Program Files\Google\Chrome\Application\chrome.exe`.
