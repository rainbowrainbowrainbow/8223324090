# R10A Redirect watchdog/recovery handoff — 2026-09-05

Worktree: `C:/Users/Plotva/OneDrive/Документи/EventGenix/.codex-temp/r9-redirect-risk-repro-20260905`
Branch: `codex/redirect-risk-repro-r9`
Accepted redirect release base: `d7aed2573d876c7051e96897a835343ed33573d5`
Pre-release frontend SHA used for compatibility check: `9ea61f1ea6c38b6f218bbc4b9ceda3f772bedbd5`

R10A і R10A-FINISH виконано локально. Backend auth/session recovery/replay contract, права доступу, 30s recovery window, schema, settings, secrets, production data, CI/config і release/version markers не змінювались. Commit/push/deploy не виконувались. Основний checkout і попередні release worktrees не змінювались.

## Scope фактично змінено

- `js/api.js`: application-level refresh watchdog на 12s через browser `window.setTimeout`. Public refresh promise повертає controlled `retry-later`, але transport не abort-иться і може пізніше завершитись через чинні generation/identity/session guards.
- `js/auth.js`: safe return-route UX, transient auth recovery UI, manual reload exit для завислого refresh, permission-ready one-shot route consumption, stale-login guard після delayed `registerAuthenticatedServiceWorker()`.
- `tests/auth-api-session-hardening.test.js`: deadline/retry-later/late-response regressions, never-settling refresh без fake late response, logout/account-switch late response, late terminal clear.
- `tests/auth-frontend-session.test.js`: real-flow safe return route після permission retry, dirty-guarded manual reload exit, stale login після delayed SW registration, logout/account-switch/newer-session guards.
- `tests/browser/r10a-recovery-login-ui-browser-smoke.js`: focused local Chrome/Edge CDP smoke для трьох R10A-FINISH flows без Playwright dependency.
- `tests/redirect-postrelease-risk-reproductions.test.js`: точність R9 proof виправлено: прибрано зайву seed session, перевіряється concrete replacement-chain, old-cohort evidence названо як old `api.js` + modeled post-grace terminal401, stalled-fetch proof переведено на керований deadline.

## R10A operation contract

Стан refresh operation: `pending → transient timeout/retry-later → success або terminal`.

- Watchdog timeout не очищає auth storage і не є доказом expired/revoked session.
- Повторні кліки під час живого transport повертають controlled `retry-later` і не запускають паралельний refresh storm.
- Для never-settling transport користувач має явний вихід: кнопка `Оновити сторінку` у transient recovery UI. Вона зберігає тільки безпечний route intent, попереджає про незбережені зміни через наявний modal guard і не обіцяє silent recovery.
- Transport не abort-иться: late response проходить через чинні sessionTokenId/order, generation, identity, logout/account-switch і newer-session guards.
- Same-session late success може застосувати нову token pair; stale response після logout/account switch або newer session не перезаписує стан.
- Тільки актуальний terminal auth result може перевести UI до повторного входу.
- `Retry-After` contract R3 не змінено.
- Немає automatic password login, нового endpoint, network telemetry або polling.

## R10A-FINISH reproduced/fixed

1. Never-settling refresh:
   - Reproduction: refresh transport не завершується; після 12s watchdog public result стає `retry-later`; повторний виклик не стартує другий `/auth/refresh`.
   - Fix: recovery UI дає ручну дію reload із dirty guard і safe route persistence. Auth storage не очищується, старий refresh token не надсилається повторно окремою операцією.

2. Return route після retry bootstrap:
   - Reproduction: saved `/certificates` → login/checkSession success → тимчасова permissions помилка → retry → permissions ready.
   - Fix: `consumeAuthReturnRoute()` не споживає intent, доки permission lifecycle не `ready`; `checkSessionAttempt()` застосовує return route до `showMainApp()`. Already-on-target route не запускає fallback на Timeline.

3. Stale navigation після delayed Service Worker registration:
   - Reproduction: login → `registerAuthenticatedServiceWorker()` затриманий → logout/account switch → SW promise завершується.
   - Fix: `login()` повторно перевіряє актуальність bootstrap session після `await registerAuthenticatedServiceWorker()` перед Sidebar init, protected shell, return-route consumption або default navigation.

## Corrected R9 evidence still valid

### Lost committed refresh response

Harness викликає реальні `createTokenPair` / `rotateRefreshToken` з `middleware/auth.js` через fake transaction pool.

| Delay | Status | Code | Recovered | Active refresh tokens | Classification |
| --- | ---: | --- | --- | ---: | --- |
| 6s | 200 | — | true | 1 | expected safe recovery |
| 31s | 401 | `refresh_token_reuse` | false | 0 | residual product risk under current backend contract |
| 60s | 401 | `refresh_token_reuse` | false | 0 | residual product risk under current backend contract |
| 120s | 401 | `refresh_token_reuse` | false | 0 | residual product risk under current backend contract |

Duplicate/no-proof controls:

| Delay | Status | Code | Active refresh tokens | Meaning |
| --- | ---: | --- | ---: | --- |
| 4s | 409 | `refresh_already_rotated` | 1 | duplicate grace without proof |
| 31s | 401 | `refresh_token_reuse` | 0 | post-grace hostile replay terminal |

### Old-cohort compatibility proof

Accurate label: old `api.js` from `9ea61f1ea6c38b6f218bbc4b9ceda3f772bedbd5` + modeled new backend post-grace terminal401. This is not a passed real browser → new backend/SW upgrade proof.

Corrected chain result:

- After lost committed response: T0 revoked → T1 active, shared old storage still has T0.
- After second old tab post-grace replay without proof: T0 replay is terminal and revokes the concrete T1 replacement; active refresh token count is `0`.
- There is no extra constructor seed session and no `activeCount=1` orphan claim.

## Verification actually run

```powershell
npm run check:runtime
node --check js\api.js
node --check js\auth.js
node --check tests\browser\r10a-recovery-login-ui-browser-smoke.js
node --test tests\auth-api-session-hardening.test.js tests\auth-frontend-session.test.js
node --test tests\redirect-auth-regression-gate.test.js tests\redirect-rate-limit-regression-gate.test.js tests\service-worker-redirect-regression-gate.test.js tests\redirect-diagnostics.test.js tests\redirect-postrelease-risk-reproductions.test.js
node tests\browser\r10a-recovery-login-ui-browser-smoke.js
npm test
git diff --check
```

Results so far in final R10A-FINISH pass:

- Runtime: PASS, Node `22.23.1` / npm `10.9.8`.
- Syntax: PASS for `js/api.js`, `js/auth.js`, focused browser smoke.
- Focused frontend/API auth/session suite: `114 pass / 0 fail`.
- R2/R3/R4/R5/R9 redirect gates: `22 pass / 0 fail`.
- Focused local Chrome/Edge CDP smoke: PASS for manual reload exit, return route after permission retry, stale login after delayed SW registration.
- Full `npm test`: PASS, UI check `1310 passed / 0 failed`.
- `git diff --check`: PASS.

A broader existing `tests/browser/redirect-regression-gate-browser-smoke.js` was also attempted during investigation and failed before R10A-FINISH proof with `INFRA: /certificates did not load certificates.html` on its static R4 server. It is not used as R10A-FINISH acceptance evidence; focused CDP smoke above covers the requested recovery/login UI flows.

## PG / production note

R10A-FINISH changed only frontend watchdog/recovery UX and tests. Backend auth/session replay logic was not changed, so no new disposable PostgreSQL proof was required for this narrow block. Production `DATABASE_URL` was not used. No live fault injection or production QA was run.

## Residual risks

- 31s / 60s / 120s post-rotation replay remains terminal under the current backend contract. R10A/R10A-FINISH intentionally does not eliminate this residual backend risk and does not extend recovery window.
- Real browser → new backend/SW upgrade proof for old pre-release tabs remains not proven; the R9 evidence is a VM compatibility proof using real old `api.js` plus modeled terminal backend behavior.
- Physical phone, Safari/WebKit, and real mobile network switching were not tested in R10A-FINISH.
- R11 still owns Service Worker/version-update UI and old-tab migration behavior.

## Handoff for next work

R10B, if approved separately, should address backend exact-session recovery only if product requires silent recovery past the current 30s contract. It must preserve hostile replay, logout, revocation, deactivation, account isolation and no-proof terminal behavior.

R11 should handle SW/version-update UI and real old-tab upgrade browser proof. Do not treat the R10A watchdog or focused recovery/login CDP smoke as proof of old SW/browser cohort upgrade behavior.

