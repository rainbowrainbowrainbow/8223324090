# R11 Redirect old-tab compatibility handoff — R11C final update — 2026-09-06

Worktree: `C:/Users/Plotva/OneDrive/Документи/EventGenix/.codex-temp/r9-redirect-risk-repro-20260905`
Branch: `codex/redirect-risk-repro-r9`
Base accepted redirect release: `d7aed2573d876c7051e96897a835343ed33573d5`
Pre-release frontend fixture: `9ea61f1ea6c38b6f218bbc4b9ceda3f772bedbd5`
Released frontend fixture: `d7aed2573d876c7051e96897a835343ed33573d5`

R11C виконувався локально тільки в межах actual-app proof harness, tests і handoff. Product `sw.js`, frontend auth/session product logic, backend auth/replay contract, 30s recovery window, permissions, schema, CI/config, secrets, production settings і version markers у R11C не змінювались. Commit/push/deploy/live-site QA не виконувались. Production `DATABASE_URL` не використовувався.

## R11C harness changes

- `tests/browser/redirect-old-tab-upgrade-browser-smoke.js`
  - Browser probes встановлюються через CDP `Page.addScriptToEvaluateOnNewDocument` для кожного нового документа, а не лише через `evaluate()` у вже відкритій Timeline page.
  - Probe має `probeInstalled`, `probeVersion`, `documentId`, `listenersInstalled`, bounded event log, `pageshow`, `visibilitychange` і `controllerchange` counter.
  - `waitForModule()` тепер fail-ить окремо, якщо observer/listeners/documentId відсутні після navigation, і додає `pageProbe` diagnostics у timeout error.
  - Додано CDP-level trace поза документом: `Page.frameNavigated`, `Page.lifecycleEvent`, `Runtime.executionContext*`, `ServiceWorker.*` events.
  - `triggerServiceWorkerUpdate()` збирає bounded trace worker version/state і registration snapshots: before update, updatefound, after registration update, polling, final.
  - SW update proof фіксує document/input evidence до і після update та класифікує document change як `same-document`, `new-document` або `unknown-document-identity`.
  - Main runner не зупиняє всі незалежні секції після першого failure; збирає PASS/FAIL по cohorts/checks, пише proof artifact і повертає non-zero наприкінці.
  - Між cohorts додано isolated origin cleanup через CDP `Storage.clearDataForOrigin`.
  - Current-candidate protected navigation у harness отримала pre-document localStorage seed через init script, щоб не стартувати app bootstrap до test auth state.
  - Certificates detection у harness більше не залежить лише від вузьких старих anchors: перевіряється route/body/title, а anchors лишаються diagnostic evidence.

## Actual command executed after Docker recovered

Запуск виконувався з власним disposable PostgreSQL 16 container, process-local `TEST_DATABASE_URL`, process-local `TEST_DATABASE_RESET_CONFIRM=RESET_DISPOSABLE_TEST_DATABASE`, synthetic test account і без production DB fallback.

```powershell
node scripts/run-isolated-postgres-tests.js redirect-upgrade
```

Final result: `FAIL`, not accepted.

Proof artifact:

`C:/Users/Plotva/OneDrive/Документи/EventGenix/.codex-temp/r9-redirect-risk-repro-20260905/output/browser/redirect-old-tab-upgrade/r11-old-tab-upgrade-proof.json`

Disposable containers were removed. Final read-only cleanup check:

```powershell
docker ps -a --filter "name=eventgenix-r11c-pg-" --format "{{.Names}} {{.Status}}"
```

returned no containers.

## PASS evidence from redirect-upgrade

Historical actual-app old-tab cohorts passed:

- `pre-release-frontend-to-current-candidate` — PASS
  - fixture SHA: `9ea61f1ea6c38b6f218bbc4b9ceda3f772bedbd5`;
  - old Leads tab stayed on `/sales-funnel`;
  - old Certificates tab stayed on `/certificates`;
  - new current tab opened `/certificates`;
  - observer installed in new documents;
  - unsaved input on old Leads tab stayed `unsaved r11 proof`;
  - no Timeline substitution and no forced logout observed in this cohort.

- `released-frontend-to-current-candidate` — PASS
  - fixture SHA: `d7aed2573d876c7051e96897a835343ed33573d5`;
  - old Leads tab stayed on `/sales-funnel`;
  - old Certificates tab stayed on `/certificates`;
  - new current tab opened `/certificates`;
  - observer installed in new documents;
  - unsaved input on old Leads tab stayed `unsaved r11 proof`;
  - no Timeline substitution and no forced logout observed in this cohort.

R11B background/rAF conclusion remains valid and is now separated from product behavior:

- hidden/background tab had `visibilityState: hidden`, `hasFocus: false`, `rafRan: false`;
- after CDP activation/bringToFront, real sidebar click navigated to `/sales-funnel`;
- the original R11B blocker was harness/background-tab setup, not a proven product sidebar regression.

## FAIL evidence from redirect-upgrade

The full R11 acceptance is still `FAIL` because supplemental current-candidate scenarios did not pass:

1. `navigationLifecycleOffline` — FAIL.
   - Real click attempt ended on `/graduation`, not `/certificates`.
   - Diagnostic: Certificates link existed but was below viewport (`y=2237`) and `elementFromPoint` was `null`; sidebar links list was empty after landing on the wrong page.
   - Classification: likely harness click/scroll synchronization issue, not yet a proven product regression. The proof must scroll/activate the real sidebar target before claiming product navigation failure.

2. `currentUpdatePrompt` — FAIL.
   - `window.renderAuthenticatedServiceWorkerUpdatePrompt` was not available.
   - Code evidence: `renderAuthenticatedServiceWorkerUpdatePrompt()` exists inside `js/auth.js`, but is not exported to `window`.
   - Classification: harness/test-design gap for direct invocation. It is not valid to fix this in R11C by exposing product internals solely for the test. The scenario should be driven by a real SW update/future-update fixture or an approved product API decision.

3. `lostDelayedRefresh` — FAIL.
   - Lost-response retry inside backend grace returned `{ ok: false }`.
   - Server tail included `[Auth] Refresh failed: Refresh token was already rotated by this client`.
   - Classification: current actual-app proof failure requiring focused triage. It is not accepted as silent recovery. Do not change backend recovery/replay contract inside R11C.

4. `logoutDuringUpdate` — FAIL.
   - Same root as update prompt direct-call gap: `TypeError: window.renderAuthenticatedServiceWorkerUpdatePrompt is not a function`.
   - Classification: harness/test-design gap unless R11/R11D explicitly decides to expose a safe testable product surface or drive the scenario through real SW lifecycle.

Real BFCache proof was not observed: `realBfcachePersisted: false`. Synthetic lifecycle checks remain separate from real BFCache evidence.

## Other verification after R11C changes

PASS:

```powershell
node --check tests/browser/redirect-old-tab-upgrade-browser-smoke.js
node --check tests/browser/r10a-recovery-login-ui-browser-smoke.js
node --check js/auth.js
npm run check:runtime
git diff --check
```

Focused R9/R10A suite after R11C harness changes, rerun with escalation because sandbox Node runner returned `spawn EPERM`:

```powershell
node --test tests/auth-api-session-hardening.test.js tests/auth-frontend-session.test.js tests/redirect-postrelease-risk-reproductions.test.js
```

Result: PASS, `120 pass / 0 fail`.

R2–R5 redirect gates after R11C harness changes, rerun with escalation because sandbox Node runner returned `spawn EPERM`:

```powershell
node --test tests/redirect-auth-regression-gate.test.js tests/redirect-rate-limit-regression-gate.test.js tests/service-worker-redirect-regression-gate.test.js tests/redirect-diagnostics.test.js
```

Result: PASS, `18 pass / 0 fail`.

Runtime:

```powershell
npm run check:runtime
```

Result: PASS, Node `22.23.1` / npm `10.9.8`.

`git diff --check`: PASS, only LF→CRLF working-copy warnings.

Previously relevant context: before R11C final harness-only changes, R11B had `npm test` PASS with UI smoke `1310 passed / 0 failed`. This is context only; it does not replace the failing `redirect-upgrade` proof.

## R11 status

Overall status: `NOT READY`.

Reason: mandatory actual-app proof now runs against disposable PostgreSQL, but full suite fails in 4 sections. Historical old-tab cohorts are no longer blocked by missing probes and now have PASS evidence, but the current-candidate supplemental scenarios remain unresolved.

## Remaining risks / not accepted

- Full R11 cannot be marked accepted until `node scripts/run-isolated-postgres-tests.js redirect-upgrade` is green or failures are split into approved narrower product fixes with new passing proof.
- `lostDelayedRefresh` produced an actual recovery failure under the current proof. This may relate to R10B/backend replay limits and must not be silently reclassified as PASS.
- The safe update prompt cannot be tested by directly calling a non-exported internal function. A future proof should drive real SW lifecycle or explicitly design a public local-only/testable trigger without weakening product behavior.
- Sidebar click to offscreen Certificates needs harness scroll/visibility correction before treating `/graduation` navigation as product failure.
- Real BFCache is still not proven.
- Physical phone/Safari/WebKit/mobile network switching remain not run.
- Backend replay beyond 30 seconds remains R10B and is still terminal by current backend contract.

## Recommended next step

Run a narrow R11D/test-proof cleanup, still without product code changes first:

1. make current-candidate sidebar click scroll the exact target into viewport before CDP click;
2. replace direct `window.renderAuthenticatedServiceWorkerUpdatePrompt()` calls with real SW update/future-update fixture evidence, or explicitly design a safe product/test surface if required;
3. isolate `lostDelayedRefresh` with the existing disposable PG proof and decide whether it is a real R10B backend contract gap or a harness ordering problem.

Do not start release preparation until the resulting `redirect-upgrade` proof is PASS or a product regression is accepted into a new bounded fix scope.

## R11D update — 2026-09-06

Scope: R11D змінював тільки actual-app proof harness, focused regression tests і цей handoff. Product code, backend auth/replay contract, 30s recovery window, permissions, schema, CI/config, secrets, version markers, commit/push/deploy/live QA не змінювались.

### R11D harness/test corrections made

- `tests/browser/redirect-old-tab-upgrade-browser-smoke.js`
  - Додано runtime/network identity evidence для фактично виконуваних `js/api.js`, `js/auth.js`, `sw.js`: served hashes, CDP network responses, script errors, runtime availability of `apiRefreshAuthSession`, `apiVerifyToken`, `renderAuthenticatedServiceWorkerUpdatePrompt`.
  - `renderAuthenticatedServiceWorkerUpdatePrompt` більше не перевіряється direct product export як доказ exact candidate. Update UX ведеться через real SW update path або явно позначений `future-update-fixture`; fixture не називається exact candidate artifact.
  - Виправлено refresh proof: `apiRefreshAuthSession()` викликається без `{ reason }`, бо об’єкт-аргумент є `expectedUserOverride`, а не diagnostic metadata.
  - Success перевіряється через `outcome === 'success'`, наявність `accessToken`, актуальний refresh-token у storage і server verify. Harness більше не вимагає `result.refreshToken`, бо API його не повертає.
  - Додано evidence для committed refresh chain, storage після першої “lost” відповіді, elapsed від server commit і redacted request/status/outcome classification.
  - Якщо перший lost-response виклик уже auto-recovers у frontend і storage отримує новий refresh-token, сценарій класифікується як `frontend-auto-recovered-first-lost-response`, а не як stale post-window replay.
  - Sidebar click переведено з ephemeral marker на live href-based lookup/scroll. Harness активує вкладку, відкриває групу, скролить real scrollable ancestors (`#sidebarNav`, `#sidebarLinks`, group/items, document), перевіряє `elementFromPoint` перед CDP mouse events і не використовує direct navigation.
  - `ensureControlledBy()` більше не виконує `location.reload()` всередині page `Runtime.evaluate`; reload виконується CDP helper-ом. Redundant reload-и старих cohorts після `ensureControlledBy()` прибрані, бо helper уже перезавантажує документ, коли це потрібно для controller.
  - Session init seed тепер можна прибрати через `Page.removeScriptToEvaluateOnNewDocument`, щоб update/logout proof не відновлював старий auth storage після контрольної точки.

- `tests/auth-frontend-session.test.js`
  - Додано regression, який доводить попередню помилку harness: `apiRefreshAuthSession({ reason: ... })` трактує об’єкт як expected-user override і повертає `superseded`.
  - Додано regression, що successful `apiRefreshAuthSession()` повертає access outcome, не повертає `result.refreshToken`, але зберігає rotated refresh-token у storage.

### Actual-app redirect-upgrade proof after R11D

Command shape used each time:

```powershell
node scripts/run-isolated-postgres-tests.js redirect-upgrade
```

Environment: власний disposable PostgreSQL 16 Docker container `eventgenix-r11d-pg-*`, process-local `TEST_DATABASE_URL`, process-local `TEST_DATABASE_RESET_CONFIRM=RESET_DISPOSABLE_TEST_DATABASE`, synthetic test account only, `DATABASE_URL` removed for the process. Production DB was not used. Final cleanup check:

```powershell
docker ps -a --filter "name=eventgenix-r11d-pg-" --format "{{.Names}} {{.Status}}"
```

returned no containers.

Latest proof artifact:

`C:/Users/Plotva/OneDrive/Документи/EventGenix/.codex-temp/r9-redirect-risk-repro-20260905/output/browser/redirect-old-tab-upgrade/r11-old-tab-upgrade-proof.json`

Latest result: `FAIL`, not accepted.

Failures still present after R11D harness fixes:

1. `pre-release-frontend-to-current-candidate` — `CDP timeout for Runtime.evaluate`.
   - Occurs in old-tab bootstrap/SW-control phase before business navigation evidence.
   - R11D removed two confirmed false causes: background tab not activated for SW-control and reload from inside page `Runtime.evaluate`; timeout still reproduces.
   - Classification: `infrastructure/browser-harness blocker` until narrowed further. It is not valid to replace this with direct navigation or patched historical bytes.

2. `released-frontend-to-current-candidate` — `CDP timeout for Runtime.evaluate`.
   - Same class as pre-release cohort.
   - Classification: `infrastructure/browser-harness blocker` unless a smaller repro proves a product old-tab freeze.

3. `lostDelayedRefresh` — Certificates bootstrap reached `/certificates` with current user/access/refresh storage and executed `api.js`, but `#mainApp` stayed hidden until timeout.
   - Latest probe showed: `path=/certificates`, `hasApiRefresh=true`, `hasCertificates=true`, `currentUser=true`, `accessToken=true`, `refreshToken=true`, `controller=/sw.js`, `shellVisible=false`, `loginVisible=false`.
   - This was not reclassified as PASS, because protected shell visibility is a real user-visible requirement.
   - Classification: `product-or-bootstrap blocker requiring focused repro`. It may be a candidate bootstrap/lifecycle issue or a harness seeding/order issue; R11D did not change product auth/session to mask it.

Resolved previous R11C false failures:

- Sidebar offscreen/marker false failure is no longer the active failure in the latest artifact.
- Direct-call update prompt false failure is no longer the active failure; update proof is fixture-driven where applicable.
- Old `ok:false` refresh assertion was replaced with the real `apiRefreshAuthSession()` contract. The current app can auto-recover the first lost response before user retry; such runs are classified separately and are not counted as 31s stale replay proof.

### Verification run after R11D edits

PASS:

```powershell
node --check tests/browser/redirect-old-tab-upgrade-browser-smoke.js
node --check tests/auth-frontend-session.test.js
npm run check:runtime
```

Runtime result: Node `22.23.1` / npm `10.9.8`.

PASS after sandbox `spawn EPERM`, rerun with escalation:

```powershell
node --test tests/auth-frontend-session.test.js --test-name-pattern "apiRefreshAuthSession|return route|Service Worker registration|delayed Service Worker registration"
```

Result: `68 pass / 0 fail`.

```powershell
node --test tests/auth-api-session-hardening.test.js --test-name-pattern "refresh|replay|revoked|deactivated|logout"
```

Result: `50 pass / 0 fail`.

```powershell
node --test tests/redirect-auth-regression-gate.test.js tests/redirect-rate-limit-regression-gate.test.js tests/service-worker-redirect-regression-gate.test.js tests/redirect-diagnostics.test.js tests/redirect-postrelease-risk-reproductions.test.js tests/service-worker-policy.test.js
```

Result: `37 pass / 0 fail`.

`npm run check:syntax` initially failed inside sandbox with `spawnSync ... EPERM` for every file. Rerun with escalation passed:

```powershell
npm run check:syntax
```

Result: `JavaScript syntax check passed: 1082 files.`

```powershell
git diff --check
```

Result: PASS; only LF→CRLF working-copy warnings for existing dirty files.

Not run as acceptance proof: full `npm test`, because the mandatory actual-app `redirect-upgrade` proof is still failing and must not be replaced by broader unit/static coverage.

### R11D status

Overall status: `NOT READY`.

Reason: R11D removed confirmed harness false failures and kept R2–R5/R10A gates green, but the required actual-app old-tab proof is still not accepted because two old cohorts hit CDP Runtime.evaluate timeouts and the current lost/delayed refresh path exposes a hidden protected shell on Certificates during bootstrap.

### Remaining risks / next narrow scope

- Do not release based on this worktree until `node scripts/run-isolated-postgres-tests.js redirect-upgrade` is PASS or the remaining blockers are split into approved product fixes with new evidence.
- Next narrow fix scope should isolate the old-cohort `Runtime.evaluate` timeout with a single-page minimal CDP trace: exact method, frame/navigation state, target attached state, service-worker state, console/page errors, and whether the old document is actually hung or only CDP evaluation is blocked.
- Separately reproduce Certificates bootstrap with current candidate, synthetic auth storage, and no refresh fault. If `#mainApp.hidden` reproduces without fault, it is a focused product bootstrap/lifecycle bug; if it only appears after refresh-fault setup, isolate storage/order race in the harness.
- Backend replay beyond 30s remains R10B and was not changed. R11D did not prove or fix silent recovery for 31/60/120s stale replay.
- Real BFCache remains not proven in this R11D run.

---

# R11D-FINISH update — 2026-09-06

Scope виконано локально тільки в `tests/browser/redirect-old-tab-upgrade-browser-smoke.js` і цьому handoff. Product auth/session logic, product Service Worker, Certificates/Leads/Timeline product code, backend replay contract, 30s recovery window, schema, CI/config, secrets, version markers, commit/push/deploy/live QA не змінювались.

## Harness corrections

- Прибрано harness-generated session churn у actual-app сценаріях: початкова browser session сіється один раз на `__harness/blank` до app bootstrap. Друга вкладка відкривається зі shared origin storage. Harness більше не додає persistent seed init-script у перевірювані документи і не reseed-ить generation/tokens/user після navigation/reload.
- Seed тепер використовує canonical user shape із `/api/auth/verify` після login, щоб test fixture не створював зайвий `pzp_current_user` rewrite через відмінний JSON shape.
- Додано probe auth-storage events для ключів auth storage без значень token/user. Two-tab control fail-ить на token/generation churn, але зберігає benign same-user `pzp_current_user` rewrites як evidence.
- `collectSidebarClickReadiness()` більше не чекає page-side `setTimeout` у hidden document. rAF scheduling вимірюється зовнішнім Node clock, тому hidden-tab timer throttling не маскує actual-app behavior.
- Background sidebar/rAF control тепер ізольований: visible Timeline bootstrap лишається mandatory, але hidden-target CDP `Runtime.evaluate` timeout класифікується як `INFRA_BLOCKED` у background-control evidence і не валить actual-app old-tab cohort.
- `ensureControlledBy()` розділяє SW registration start, `serviceWorker.ready` і controller polling. Якщо `ready` resolved без controller, harness виконує контрольований reload і потім окремо чекає controller. У фінальному proof SW-ready timeout не відтворився; controller був досягнутий для історичних і current/future SW bytes.
- Додано per-subcase artifacts для lost refresh evidence і post-SW assertion failure evidence, щоб наступне падіння не стирало chain/document/SW дані вже виконаних підсценаріїв.

## Final actual-app proof

Command:

```powershell
node scripts/run-isolated-postgres-tests.js redirect-upgrade
```

Environment:

- власний disposable PostgreSQL 16 Docker container з префіксом `eventgenix-r11d-finish-pg-`;
- process-local `TEST_DATABASE_URL` і `TEST_DATABASE_RESET_CONFIRM=RESET_DISPOSABLE_TEST_DATABASE`;
- `DATABASE_URL` видалявся з process env перед запуском proof;
- synthetic test account/data only;
- production DB не використовувалась.

Result: `PASS`.

Proof artifact:

`C:/Users/Plotva/OneDrive/Документи/EventGenix/.codex-temp/r9-redirect-risk-repro-20260905/output/browser/redirect-old-tab-upgrade/r11-old-tab-upgrade-proof.json`

Candidate identity in proof:

- `currentSha`: `d7aed2573d876c7051e96897a835343ed33573d5`
- dirty candidate asset hashes:
  - `sw.js`: `63b4a83410fddb18944d5fa36f760ff54287197cac0bac7e49d90425efccd369`
  - `js/api.js`: `c73720b5fde60b277c7524974a760b34bfb451b62692e4225704ee2c404682e9`
  - `js/auth.js`: `ff73093ff25bacebd6b9f7cbf7e2c2bc3f0b7070ffacfd187a2703b3efbcae63`
  - `js/components/sidebar.js`: `e9bf38c47b209d350438e5cef2e4a99c2ef9c82d9abec77787f28e25ece158d7`
  - `index.html`: `cb6b2078c80a130716c0780b2393e0cdd93d94d2bb720041970ef33bfd457b27`
  - `leads.html`: `71af65ce0f09e47a3392aeb0740b818b2e10edd47d805c918e33191222847ea0`
  - `certificates.html`: `f3baf12becf7f03ed8252c1e08efda699050a4730688508c496e6c102087edc7`

Passed sections:

- `pre-release-frontend-to-current-candidate`: PASS.
  - Fixture SHA: `9ea61f1ea6c38b6f218bbc4b9ceda3f772bedbd5`.
  - Real historical frontend/SW bytes were served.
  - Real SW upgrade to current dirty candidate bytes occurred.
  - `documentChangeA`: `same-document`; `documentChangeB`: `same-document`.
  - Old Leads tab stayed on `/sales-funnel`, kept unsaved input `unsaved r11 proof`, did not show login, and did not fall back to Timeline.
  - Old Certificates tab stayed on `/certificates`, did not show login, and did not fall back to Timeline.
  - New current tab opened `/certificates` and completed authenticated bootstrap.

- `released-frontend-to-current-candidate`: PASS.
  - Fixture SHA: `d7aed2573d876c7051e96897a835343ed33573d5`.
  - Real released frontend bytes were served, then local dirty candidate SW bytes were served.
  - Real SW upgrade to current dirty candidate bytes occurred.
  - `documentChangeA`: `same-document`; `documentChangeB`: `same-document`.
  - Old Leads tab stayed on `/sales-funnel`, kept unsaved input `unsaved r11 proof`, did not show login, and did not fall back to Timeline.
  - Old Certificates tab stayed on `/certificates`, did not show login, and did not fall back to Timeline.
  - New current tab opened `/certificates` and completed authenticated bootstrap.

- `navigationLifecycleOffline`: PASS.
  - Timeline ↔ Leads ↔ Certificates via real sidebar clicks.
  - Back/Forward passed.
  - Synthetic visibility/pageshow lifecycle passed.
  - Offline/reconnect passed.
  - `realBfcachePersisted`: `true` in this final Chrome CDP run.

- `currentUpdatePrompt`: PASS.
  - Future-update fixture is explicitly synthetic and not an exact candidate artifact.
  - “Пізніше” did not navigate or clear auth storage.
  - Dirty cancel preserved route/input.
  - Dirty confirm caused a real new document after reload and completed bootstrap on `/certificates`.

- `lostDelayedRefresh`: PASS.
  - Before fault injection, two Certificates tabs completed authenticated bootstrap in 3 consecutive control passes.
  - Shell visible in both tabs; document IDs/generation stable; no mutual reload loop observed.
  - `pzp_auth_session_generation` stayed equal across both tabs and reload passes.
  - No token/generation auth-storage events were observed. Benign `pzp_current_user` rewrites were recorded separately and did not change generation/tokens.
  - Duplicate grace, recovery-window, terminal-post-window, and delayed concurrent refresh subcases passed with server-accepted access tokens where success was expected.

- `logoutDuringUpdate`: PASS.
  - Logout/account-switch guard during update did not restore access token, refresh token, or cached user after reload.

Failures: none.

Background control status:

- Both historical cohorts record `backgroundControl.status = INFRA_BLOCKED`, phase `hidden-tab-readiness-or-click`, reason `CDP timeout for Runtime.evaluate`.
- This is isolated to evaluating/clicking an intentionally hidden CDP target. Visible Timeline bootstrap before hiding passed, and actual old-tab proof uses CDP activation/bringToFront before real sidebar clicks. It is not classified as a product failure.

## Verification after R11D-FINISH

Passed:

```powershell
node --check tests/browser/redirect-old-tab-upgrade-browser-smoke.js
node --check tests/browser/r10a-recovery-login-ui-browser-smoke.js
npm run check:runtime
node --test tests/auth-frontend-session.test.js --test-name-pattern "apiRefreshAuthSession|return route|Service Worker registration|delayed Service Worker registration|watchdog|late"
node --test tests/auth-api-session-hardening.test.js --test-name-pattern "refresh|replay|revoked|deactivated|logout"
node --test tests/redirect-auth-regression-gate.test.js tests/redirect-rate-limit-regression-gate.test.js tests/service-worker-redirect-regression-gate.test.js tests/redirect-diagnostics.test.js tests/redirect-postrelease-risk-reproductions.test.js tests/service-worker-policy.test.js
npm run check:syntax
git diff --check
```

Observed results:

- Runtime baseline: Node `22.23.1` / npm `10.9.8`.
- Frontend focused tests: `68/68` PASS.
- Auth API focused tests: `50/50` PASS.
- Redirect/SW/R9/R10A/R2-R5 focused gates: `37/37` PASS.
- Syntax check: `1082` files PASS.
- `git diff --check`: PASS; only existing LF→CRLF working-copy warnings for `js/auth.js` and `tests/auth-api-session-hardening.test.js` were printed.
- Initial sandboxed Node test/syntax attempts failed with `spawn EPERM`; the same commands passed when rerun outside the sandbox. This is recorded as infrastructure, not product/test failure.
- Disposable PostgreSQL cleanup check for `eventgenix-r11d-finish-pg-` returned no containers.

## Remaining limits and next scope

- R11D-FINISH does not change backend recovery/replay behavior. Stale refresh replay after the current backend recovery window remains R10B scope and must not be described as silent recovery fixed by R11.
- Background hidden-tab CDP click/evaluate remains an infrastructure limitation of this harness. The actual product proof uses activated tabs and real sidebar clicks.
- No Safari/WebKit or physical-phone proof was run here. Chrome CDP actual-app evidence must not be relabeled as mobile/WebKit evidence.
- No production QA, production mutation, deploy, push, commit, schema/config/secret/version change was performed.

Recommended next step: if release preparation resumes, use this final R11D-FINISH proof artifact as the local actual-app old-tab evidence, then run the normal release-candidate process on a clean worktree and exact SHA.
