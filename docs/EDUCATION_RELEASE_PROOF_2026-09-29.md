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

Release: in progress.

The pre-release live `/api/version` check returned `v0.82.40`, SHA `c3814734dcc39c9b79b7de0cbaff1bfde7557861`, source branch `codex/eventgenix-production`, with complete deployment-manifest metadata. The authenticated CRM session is Creator in business context Дар; the visible menu includes «Налаштування таймлайну». No production business data has been changed. Final SHA, exact-SHA CI, Railway deployment and post-deploy QA evidence will be recorded here after each gate passes.
