# Education release proof — 2026-09-29

## Release identity

- **Status:** EDU-05 delivered. Production impact: yes.
- **Production source:** `codex/eventgenix-production`; previous live/remote SHA `640ad3165f41d68646bc4cb841945d1fc1efdaf4` (`v0.82.39`). The release was a fast-forward descendant; the unrelated dirty primary checkout was not changed.
- **Deployed SHA:** `c3814734dcc39c9b79b7de0cbaff1bfde7557861`, `v0.82.40 — Заняття: розклад, групи та відвідування`.
- **CI:** [run 36571206812, attempt 2](https://github.com/rainbowrainbowrainbow/8223324090/actions/runs/36571206812/attempts/2) — all 8 jobs `success`, including the disposable PostgreSQL education API/integration scenario, Fast baseline, browser suites and the required Omni check. Attempt 1 failed only the Omni actual-app mobile layout assertion at `390×844` (`shell.bottom=847`); the same SHA passed a failed-job-only rerun without source or guard changes.
- **Railway:** project `fortunate-appreciation` (`bc28b46c-d4bc-491c-893a-d8401c633668`), environment `production`, app service `8223324090` (`3fb62d4c-2dc2-4701-8e2b-09ce16e188ee`), deployment `735e8e55-508c-4079-afd9-1cea42acf610` — `SUCCESS`. Used only `npm run release:railway-up` with `RELEASE_DEPLOY_BRANCH=codex/eventgenix-production` from a clean managed worktree; no Railway settings or secrets changed.
- **Live proof:** `GET /api/version` and standalone `npm run version:smoke` returned `v0.82.40`, exact SHA, exact branch and complete `manifest` metadata. The login HTML showed the same version label.

## Migration and QA evidence

| Scenario | Result | Evidence / limit |
| --- | --- | --- |
| Additive DB migration 372/373 | PASS | Read-only production `schema_migrations` contains `372_education_groups` and `373_education_attendance`; `education_groups`, `education_attendance` and `education_attendance_history` exist. Applied only by normal startup flow. |
| Local release checks | PASS | Node 22.23.1/npm 10.9.8, focused education/access tests 18/18, `npm test`, version sync, migration governance, protected timeline surface and `git diff --check`. Local PostgreSQL integration was not run because no disposable local DB was available; CI supplied that proof. |
| Desktop login and deployed education assets | PASS | Test account logged in; version badge `0.82.40`, five education tabs and three education client modules present. Workspace stayed hidden in the account's non-education Park context. |
| Education read API and business isolation | PASS | Authenticated read-only `GET` for groups and report in the account's current context returned `200`; `GET` for a different business returned `403`. Responses were not exported. |
| Canonical legacy booking details | PASS | An existing non-education booking opened in `#bookingModal` through `showBookingDetails(...)`; `#bookingDetails` was populated. No customer data was copied into proof. |
| Mobile shell at 390×844 | PASS for accessible Park context | Live document width was 390 px at a 390 px viewport. This does not validate visual layout of the hidden education workspace. |
| Positive live education path: group → child → series → schedule → details → attendance → report | NOT RUN live | The available test account has only the operational Park business; no existing isolated education QA business context was confirmed. No real customer/booking writes were attempted. Equivalent create, conflict, isolation, correction/history and report behavior passed disposable HTTP/PostgreSQL CI. |
| Education workspace desktop/mobile visual review | NOT RUN live | Education mode was hidden in the only accessible test business. Static assets loaded; no positive visual claim is made. |

No production QA records, messages, invoices, payments or exports were created. Browser snapshots/logs generated during QA were removed from the local release worktree after the browser closed. The additive tables remain after a code rollback; any rollback must preserve their history and use the documented manual release path, not a destructive migration.

## EDU-SETTINGS-02 — release proof

**Production impact: yes. Code release deployed; live settings acceptance is blocked by session verification.**

| Gate | Result | Evidence |
| --- | --- | --- |
| Pre-release source | PASS | Live `/api/version`: `v0.82.40`, SHA `c3814734dcc39c9b79b7de0cbaff1bfde7557861`, branch `codex/eventgenix-production`, complete manifest metadata. Remote production branch was exactly `5e22719f25f1b79f22a4ebf016a08f650c1f5bae`, the release base. |
| Railway target | PASS | Read-only `railway status`: project `fortunate-appreciation` (`bc28b46c-d4bc-491c-893a-d8401c633668`), environment `production` (`d9f9b984-d54d-4620-a8bf-c48882ad5158`), service `8223324090` (`3fb62d4c-2dc2-4701-8e2b-09ce16e188ee`). |
| Release SHA | PASS | `cc45af9982f34b2dfcb3df4ed3bbad33b268e203`, `v0.82.41 — Збереження режиму навчання`; fast-forward pushed to `codex/eventgenix-production`. |
| Exact-SHA CI | PASS | [Run 36595419689](https://github.com/rainbowrainbowrainbow/8223324090/actions/runs/36595419689): all 8/8 jobs `success`, including Fast baseline, education lesson-series PostgreSQL integration, My Day/HR browser integration, Certificate and Omni browser regression. |
| Railway deployment | PASS with CLI transport warning | Deployment `78688796-c04e-4583-8129-8f3d680188f0` reached `SUCCESS`, one instance `RUNNING`. The required `npm run release:railway-up` submitted this deployment but returned exit 1 after `Uploading…` because Railway's GraphQL request timed out. Read-only status/log checks confirmed the accepted build and eventual success; no duplicate deploy or raw `railway up` was used. |
| Live version/SHA | PASS | `npm run version:smoke` with expected commit/branch returned `v0.82.41`, exact SHA `cc45af9982f34b2dfcb3df4ed3bbad33b268e203`, `codex/eventgenix-production`, metadata `manifest`. |
| Creator page/context | PARTIAL | Authenticated CRM page showed the Creator role, selected business Дар and «Налаштування таймлайну». A session-recovery overlay then reported «Сесію тимчасово не підтверджено»; pressing its retry produced the same overlay. |
| Temporary field change / Save activation | NOT RUN | Stopped because the live session was not verified. No settings field was changed and «Зберегти» was never pressed. |
| Dar mode/data | NO WRITE | This QA issued no settings save or PUT. Persisted mode could not be independently re-read after session recovery failed; manual mode switch remains for the user. No customer records were read or changed. |

**Local verification:** `npm run check:runtime` passed on Node 22.23.1/npm 10.9.8. `npm run verify` passed, including syntax checks for 1,351 files, 1,327 UI checks, 4 code-splitting tests and all 3 EDU settings regressions. The standard test runner initially hit sandbox `spawn EPERM`; rerunning the same verifier with the approved local process permission passed.

**Release disposition:** keep the deployed fix in place; do not change Dar's mode. EDU-SETTINGS-02 cannot be marked fully accepted until a valid Creator session can re-open the page and confirm the save button activates after a reversible, unsaved form change. No automatic rollback was performed. The release SHA has green CI and a successful deployment; the remaining failure is the live session-verification QA gate.

## EDU-SETTINGS-02 follow-up — session recovery patch

**Production impact: yes. Recovery fix released; Dar's education mode remains unchanged.**

| Gate | Result | Evidence |
| --- | --- | --- |
| Root cause | PASS | `showMainApp()` called timeline-only `initializeTimeline()` on `/timeline-settings`, which does not load `timeline.js`; the thrown `ReferenceError` was caught by session bootstrap and surfaced as a false session-recovery error. |
| Fix | PASS | Optional timeline-only initializers are guarded; recovery actions use shared CRM button styles and spacing. `manage_settings` and server authorization checks are unchanged. |
| Local verification | PASS | Node 22.23.1/npm 10.9.8; `npm test` passed 3,156 tests / 119 suites with 0 failures; focused auth regression 72/72; UI smoke 1,327 checks plus education settings contracts 3/3; access, auth-boundary, CSS-surface, runtime, version and syntax checks passed. |
| Release SHA/version | PASS | `a72d91451cc68e8a70fbbf468badd3d65c832ae0`, `v0.82.42 — Стабільний вхід до налаштувань таймлайну`, fast-forward pushed to `codex/eventgenix-production`. |
| Exact-SHA CI | PASS | [Run 36608839366](https://github.com/rainbowrainbowrainbow/8223324090/actions/runs/36608839366): all 8/8 jobs succeeded, including the Fast baseline, education lesson-series PostgreSQL integration, browser suites and Omni regression. |
| Railway | PASS | Deployment `8b30f579-eef0-4a50-9bc2-a6e7da5e2451`, project `fortunate-appreciation`, environment `production`, service `8223324090`, status `SUCCESS`; submitted through `npm run release:railway-up` with explicit `RELEASE_DEPLOY_BRANCH=codex/eventgenix-production`. |
| Live version | PASS | Release helper's `version:smoke`: v0.82.42, exact SHA `a72d91451cc68e8a70fbbf468badd3d65c832ae0`, branch `codex/eventgenix-production`, complete `manifest` metadata. |
| Creator page/context | PASS | Live settings page loaded without session recovery, with Creator role and business Дар selected. |
| Save activation | PASS | A temporary unsaved checkbox change enabled «Зберегти». The button was not pressed; page reload discarded the draft and restored the disabled/clean state. |
| Dar mode/data | NO WRITE | The loaded business mode remained «Простий режим». No settings save or business-cabinet PUT was made; no customer data was read or changed. |

**Disposition:** the live session bootstrap issue is resolved. The user can now choose «Навчання» manually in «Системні режими» and save when ready; no production mode switch was performed by this release QA.
