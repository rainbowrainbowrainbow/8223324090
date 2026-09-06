# R9/R10A Redirect/session handoff — 2026-09-05

Worktree: `C:/Users/Plotva/OneDrive/Документи/EventGenix/.codex-temp/r9-redirect-risk-repro-20260905`
Branch: `codex/redirect-risk-repro-r9`
Accepted redirect release base: `d7aed2573d876c7051e96897a835343ed33573d5`
Pre-release frontend SHA used for compatibility check: `9ea61f1ea6c38b6f218bbc4b9ceda3f772bedbd5`

R10A виконано локально без backend auth/session змін, schema, permissions, settings, secrets, production mutations, commit, push або deploy. Основний checkout і попередні release worktrees не змінювались.

## Scope фактично змінено

- `js/api.js`: додано application-level refresh watchdog на 12s через browser `window.setTimeout`; public refresh promise повертає controlled `retry-later`, але transport не abort-иться і може пізніше завершитись через наявні guards.
- `js/auth.js`: додано безпечний one-shot return route для terminal login UX; route нормалізується до дозволеного модульного path без query, fragment, external URL і динамічних ID.
- `tests/auth-api-session-hardening.test.js`: додано deadline/retry-later/late-response regressions, logout/account-switch late response, late terminal clear.
- `tests/auth-frontend-session.test.js`: додано safe return route redaction/access/expiry/one-shot regressions.
- `tests/redirect-postrelease-risk-reproductions.test.js`: виправлено точність R9 proof: прибрано зайву seed session, перевіряється concrete replacement-chain, old-cohort evidence названо як old `api.js` + modeled post-grace terminal401, stalled-fetch proof переведено на керований deadline.

## R10A operation contract

Стан refresh operation: `pending → transient timeout/retry-later → success або terminal`.

- Watchdog timeout не очищає `localStorage`/session storage і не вважається доказом expired/revoked session.
- Повторні кліки під час живого transport повертають той самий controlled result і не запускають паралельний refresh storm.
- Transport не abort-иться: late response проходить через існуючі generation, identity, `sessionTokenId` ordering і logout/account-switch guards.
- Same-session late success може безпечно застосувати нову token pair.
- Late response після logout або account switch не перезаписує новішу/очищену session.
- Late terminal auth result лишається єдиним шляхом до terminal clear/relogin UI.
- `Retry-After` contract R3 не змінено.
- Немає automatic password login, мережевої telemetry, нового endpoint або polling.

## Corrected R9 evidence

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
- There is no extra constructor seed session and no longer any `activeCount=1` orphan claim.

### Stalled fetch

R10A regression now proves with controlled timers:

- before 12s deadline: public promise remains pending;
- at 12s deadline: returns `retry-later`, keeps auth storage;
- repeated action while transport is still open does not start a second refresh;
- late same-session success updates storage to the late token pair through existing guards.

## Verification actually run

```powershell
node --check js/api.js
node --check js/auth.js
node --test tests\auth-api-session-hardening.test.js tests\auth-frontend-session.test.js
node --test tests\redirect-auth-regression-gate.test.js tests\redirect-rate-limit-regression-gate.test.js tests\service-worker-redirect-regression-gate.test.js tests\redirect-diagnostics.test.js tests\redirect-postrelease-risk-reproductions.test.js
node --test tests\redirect-postrelease-risk-reproductions.test.js
npm test
git diff --check
```

Results:

- Syntax checks: PASS.
- Focused frontend auth/session suite: `109 pass / 0 fail`.
- R2–R6/R9/R10A redirect gates: `22 pass / 0 fail`.
- Corrected R9/R10A reproduction harness: `4 pass / 0 fail`.
- Full `npm test`: PASS, UI check `1310 passed / 0 failed`.
- `git diff --check`: PASS.

`npm test` confirmed Node `22.23.1` / npm `10.9.8` through `check:runtime`.

## PG / browser note

R10A changed only frontend watchdog/UX and did not alter backend auth/session replay logic. Existing backend security/replay cases stayed green in R2–R6 gates and full `npm test`; no new disposable PostgreSQL proof was required by this frontend-only scope. Production `DATABASE_URL` was not used.

## Residual risks

- 31s / 60s / 120s post-rotation replay remains terminal under the current backend contract. R10A intentionally does not eliminate this residual risk and does not extend recovery window.
- Real browser → new backend/SW upgrade proof for old pre-release tabs remains not proven; the R9 evidence is a VM compatibility proof using real old `api.js` plus modeled terminal backend behavior.
- Physical phone, Safari/WebKit, and real mobile network switching were not tested in R10A.
- R11 still owns Service Worker/version-update UI.

## Handoff for R10B/R11

R10B, if approved separately, should be a backend exact-session recovery design only if product requires silent recovery past the current 30s contract. It must preserve hostile replay, logout, revocation, deactivation, account isolation and no-proof terminal behavior.

R11 should handle SW/version-update UI and real old-tab upgrade browser proof. Do not treat the R10A watchdog as proof of old SW/browser cohort upgrade behavior.
