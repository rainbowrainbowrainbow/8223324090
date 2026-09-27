# EG-HR-12C-FINISH — release proof

Captured: 2026-09-26 19:32 UTC. Status: **RELEASED / QA_FIXTURE_HOLD CLOSED / TEMPORARY ACCESS RETIRED**. Redacted operational record; private receipts are outside Git.

## Source, CI and deployment

- Previous live rollback reference: `b0b466743e929d48681f741e8df571ee23d21b28` (`0.82.19`). Before integration, remote production was `2f4d85a107ebca85bae52cef6b6c9a84fee57721` (documentation drift only), and feature SHA was `18be138847f34a0ba935dd52d6dc6bedea9fdcb3`.
- One ordinary fast-forward production push integrated the candidate. Final feature and production remote refs both equal `18be138847f34a0ba935dd52d6dc6bedea9fdcb3`. No force push or Railway settings change.
- Exact-SHA feature [CI run 36242617023](https://github.com/rainbowrainbowrainbow/8223324090/actions/runs/36242617023): 8/8 success. Exact-SHA production [CI run 36264616517](https://github.com/rainbowrainbowrainbow/8223324090/actions/runs/36264616517): 8/8 success, including baseline, HR Team browser, HR/payroll PostgreSQL, certificate, Checkbox, My Day and Omni jobs.
- `release:railway-up` completed from a clean detached release worktree with explicit `RELEASE_DEPLOY_BRANCH=codex/eventgenix-production`. Railway project `fortunate-appreciation` (`bc28b46c-d4bc-491c-893a-d8401c633668`), environment `production` (`d9f9b984-d54d-4620-a8bf-c48882ad5158`), service `8223324090` (`3fb62d4c-2dc2-4701-8e2b-09ce16e188ee`), deployment `4fe8555e-7dc2-4b1f-b6d6-87fc12da03e5`.
- Helper version smoke and final independent `GET /api/version` both confirmed `0.82.20`, label `HR Парку: картка зі Сьогодні`, exact SHA `18be138847f34a0ba935dd52d6dc6bedea9fdcb3`, source branch `codex/eventgenix-production`, complete manifest metadata.

## Ownership and temporary access

- Fresh aggregate staff audit used a separate `eventgenix_audit_ro` connection in `REPEATABLE READ READ ONLY`; 16 required tables had zero writable privileges. New staff since 2026-09-14: 1; matching HR onboarding: 1; matching security onboarding: 1; foreign account, schedule, time and new certification/resource signals: 0; checked orphan counts: 0. The known linked-account-without-membership aggregate remains 1 and does not alter the documented staff owner decision. A pre-deploy read-only freshness query found zero staff created after the audit and zero foreign schedule/time signals.
- One authorized ≤30-minute lease temporarily added only SELECT on `public.organizations`, `public.businesses`, `public.organization_memberships` and `public.business_memberships`. The helper retired exactly those grants in `finally`; post-retirement ACL fingerprint matched its starting fingerprint `78b71644d422a521c9d2f6be540dc7e8010037c83be6491a25bb3da993a057a9`.
- The isolated Park QA account temporarily gained one active Dar membership in the same organization: `waiter`, organization role `member`, non-default, no extra roles/overrides. Creation and retirement used authenticated membership-management API with normal audit events. After retirement, active membership count was 1; Park membership matched the private before-state fingerprint, and the business profile again allowed only Park with default Park and `single` scope.

## Live QA

All product QA after login used the isolated test account and GET-only browser routing. No staff, attendance, payroll, document or biometric mutation was issued.

- Recovery `GET /api/hr/today` returned 200 and `readOnly=true`; 46 profile actions were visible. Clicking one opened the existing base HR card through `GET /api/hr/staff/:id` with ready state. Team list rendered 46 cards and visible open actions; detail 403 and retry were exercised.
- Team categories workers, interns, reserve and dismissed changed state correctly; search entered search mode. Intercepted staff-list 403 cleared cards and showed `restricted`; intercepted 500/offline showed `error`, zero cards and a retry that made a fresh successful GET.
- Real Park → Dar → Park selection worked. Dar's HR staff GET returned 403 with `restricted` and zero Park cards; Park returned to its own context. A deliberately delayed Park GET was released after switching to Dar while the new Dar GET reached the server; final state stayed `restricted` with zero stale cards.
- Staff detail 403 showed an error card; retry made a successful GET. Main card tab was ready; training, payroll and history showed restricted; work and resources showed partial states for their separate dependencies. The payroll tab had no visible compensation controls, and successful staff list/detail JSON contained no checked payroll-rate/salary keys.
- Schedule tab was visible and `GET /api/staff/schedule` returned 200. Browser test routing observed zero non-GET product requests after login.
- Focused local HR tests passed 15/15; `npm run check:version` passed; final production refs and live version still matched the CI SHA.

Residual: the delayed-response race was exercised Park → Dar, the direction that could expose Park people in Dar. The reverse delayed Dar → Park response was not repeated in live QA before temporary membership retirement; the UI context change and ordinary return trip were verified. Work/resources partial and other restricted card tabs are separate API dependencies. No new HR allowlist, payroll right, schema or production setting was changed in this finish task.

## EG-HR-12D follow-up (2026-09-27)

A deterministic synthetic browser regression now also delays a Dar team GET until after switching back to Park. It checks that the old Dar row, count and detail cannot appear, that the current Park card opens, and that loading settles. The existing Park → Dar and 403 cases remain covered. The focused HR Team browser smoke and full local `npm test` passed on Node 22/npm 10. This is test coverage, not a repeat of live two-business QA; no production membership or database lease was created for this follow-up.
