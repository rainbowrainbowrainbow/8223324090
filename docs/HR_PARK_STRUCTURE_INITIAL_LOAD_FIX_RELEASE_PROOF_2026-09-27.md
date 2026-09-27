# EG-HR-14-FINISH release proof — 2026-09-27

Production impact: yes. This proof is redacted: no credentials, account/staff IDs, names, or contacts.

## Release identity

- Authorization: EG-HR-14-FINISH request, scoped fast-forward production push and manual `release:railway-up`; no settings or data writes.
- Previous live SHA / rollback reference: `4c5fa3cfbc38fab797f5f4c95c4913cb0a4a0d63`, v0.82.28, `codex/eventgenix-production`.
- Released SHA: `915e1d7a5e1954c02e0e35701754aa5dadd7d5c6`, v0.82.29, `codex/eventgenix-production`. Fast-forward only; no merge commit or unrelated commit.
- [Feature exact-SHA CI](https://github.com/rainbowrainbowrainbow/8223324090/actions/runs/36338020158) and [production exact-SHA CI](https://github.com/rainbowrainbowrainbow/8223324090/actions/runs/36338540746): both 8/8 jobs passed on the same SHA.
- Railway project `fortunate-appreciation` (`bc28b46c-d4bc-491c-893a-d8401c633668`), environment `production` (`d9f9b984-d54d-4620-a8bf-c48882ad5158`), service `8223324090` (`3fb62d4c-2dc2-4701-8e2b-09ce16e188ee`). Successful manual deployment `1dad76cb-d9cb-493a-b13f-a168c68dd415` used only `release:railway-up` with explicit `RELEASE_DEPLOY_BRANCH=codex/eventgenix-production`.
- Helper version smoke and repeat live `GET /api/version` confirmed v0.82.29, exact release SHA and branch with complete manifest metadata. Remote production ref matched. Last verification: 2026-09-27 18:07 UTC.
- No new migrations, DB grants, memberships, HR/server permission changes, or production settings changes were included.

## Read-only test-account QA

- Direct `/hr?tab=structure` browser smoke **passed without manual Retry**. The read-only tree rendered; search, archive filter, keyboard, light/dark contrast, and small viewport geometry checks passed. The unrelated chat-unread 403 was classified separately; no structure HTTP error was ignored.
- Park `GET /api/hr/company-structure`: HTTP 200, 26 nodes, `structureAccess.readOnly=true`; zero checked forbidden structure fields (`notes`, `instructions`, `description`, `meta`, `updatedBy`, compensation fields). The same test account's Dar structure GET returned HTTP 403.
- Park staff list/detail and Today GET succeeded. Aggregate list count was 207 and Today count 46; the checked detail payload contained no compensation keys. In the live browser, Team → basic card and Today → basic card both opened successfully.
- A read-only API sequence with the same Park-only test token returned Park 200 → Dar 403 → Park 200. This proves server-side denial and recovery, not a real in-page two-business switch.
- In the test browser, intercepted structure GET 403, 500, and offline each displayed a recovery state with no stale tree nodes. Removing the interception and pressing Retry restored the structure in all three cases. The browser attempted zero API writes.
- At this release, the HR browser test covered a late Dar success after returning to Park. It did not yet force a held Park response to complete after switching to Dar or a held Dar 403 to complete after returning to Park. EG-HR-14-RACE-CLOSE adds those exact-order regressions below.

## Remaining gate and decision at initial release (historical)

**Direct-entry QA HOLD is resolved on live. The requested real Park → other business → Park browser scenario remains QA_FIXTURE_HOLD.** The only identified isolated test account currently has Park-only single-business scope. A previous temporary Dar membership was retired; this task authorized GET-only live QA and did not authorize a new membership. No creator/real account was used as a substitute. Do not describe the multi-business live QA as passed.

No observed failure warrants rollback. If rollback is later required, the previous live SHA above is the non-destructive reference; revalidate current live/remote identity and use the repository release helper under a separate authorized rollback action. The next action is to supply an already-authorized two-business test account or approve a separate bounded fixture plan, then run the remaining real switch/late-response QA without product or HR data writes.

## EG-HR-14-QA-FIXTURE-REFRESH attempt

- Production had advanced to v0.82.30 / `6f17cd90f3157cba57806d710a9bed607b40ccde` on `codex/eventgenix-production`; live and remote matched. The SHA descended from the HR fix, exact-SHA [CI](https://github.com/rainbowrainbowrainbow/8223324090/actions/runs/36340767754) passed, and the relevant HR/business-context/auth/membership code was unchanged. Railway project, production environment and app service matched the release identity.
- The isolated QA account's initial Park-only state and private membership fingerprint matched the approved plan. One authorized Dar membership activation was performed through the authenticated management API. Its `business_membership_updated` audit event was subsequently confirmed read-only.
- The QA runner stopped before browser switching because its audit assertion compared the database event timestamp with the local clock. The event timestamp lagged the private receipt by about 60 seconds; the event was present. This was a QA-runner error, not a product failure.
- The runner's `finally` called the exact authenticated Dar membership DELETE. A separate read-only check confirmed Dar inactive, Park active/default and the initial fingerprint restored. The `business_membership_deactivated` audit event was also confirmed. No HR or other business record was written, and no DB grant, product commit, push or deploy was made.
- A subsequent GET-only Park browser baseline showed the structure tree on first load with zero API writes. The real two-business switch and late-response scenario was **not executed**. `QA_FIXTURE_HOLD` remains; the one-activation authorization has been consumed. A new bounded approval is needed before any further temporary membership activation.

## EG-HR-14-QA-FIXTURE-RETRY result

- The separately authorized second attempt ran against unchanged live/remote v0.82.30 / `6f17cd90f3157cba57806d710a9bed607b40ccde`; [exact-SHA CI](https://github.com/rainbowrainbowrainbow/8223324090/actions/runs/36340767754) was green and Railway project/environment/service identity matched. The approved initial membership fingerprint was rechecked immediately before the authenticated PUT.
- One temporary Dar membership was activated with the approved `waiter` / `member`, non-default, empty-override projection. The QA account exposed exactly Park and Dar, remained in single scope with Park default, and Dar structure and payroll GETs remained HTTP 403. The management API's update audit event was verified using an ID high-water mark, avoiding the database/local clock offset from the first attempt.
- In a private browser session, the test account saw the Park structure tree on direct entry, switched Park → Dar → Park through the actual business switcher, saw no stale Park nodes in Dar, and recovered the Park tree without pressing Retry. A real Park structure GET was held during the switch. The browser attempted zero API writes.
- The authorized exact DELETE ran in `finally` after approximately eight seconds. Independent read-only verification confirmed Dar inactive, Park active/default, the initial fingerprint restored, Park-only single scope, and both update/deactivation audit event types. Live `/api/version` remained at the same release SHA. No DB grant, product data write, commit, push or deploy occurred.
- **Fixture availability HOLD resolved:** real two-business UI switching was exercised and the fixture was retired. The precise completion order of the held Park GET relative to the final Dar context was not instrumented, and a Dar HR GET is denied for this `waiter` role; therefore this run is not standalone live proof of a late response in both directions. The CI at this live SHA did not yet enforce both exact completion orders. EG-HR-14-RACE-CLOSE adds that synthetic proof separately below.

## EG-HR-14-RACE-CLOSE — evidence boundary

- At 2026-09-27 20:00 UTC, live `GET /api/version` and remote production both reported v0.82.30 / `6f17cd90f3157cba57806d710a9bed607b40ccde` on `codex/eventgenix-production`; [production exact-SHA CI](https://github.com/rainbowrainbowrainbow/8223324090/actions/runs/36340767754) was green. The feature worktree was fast-forwarded to that production base without altering other worktrees.
- **Live QA fact:** the earlier authorized temporary fixture verified direct Park structure entry and a real Park → Dar → Park browser switch, Dar HTTP 403, no stale nodes in Dar, Park recovery without Retry, and zero browser API writes. The temporary Dar membership was deactivated. That session did **not** instrument the precise completion order of both held HTTP responses.
- **Synthetic race evidence:** the existing HR structure browser smoke now holds a Park GET until after the active context is Dar, then resolves it and checks that no Park node appears; Dar 403 settles as restricted rather than endless loading. It then holds Dar success until after Park is ready, and separately holds Dar 403 until after Park is ready; neither can repaint Park, change its ready state, or require manual Retry. The test explicitly checks the current business and request order. No new live fixture was created.
- Local Node 22.23.1/npm 10.9.8 checks passed: `npm run test:browser:hr-structure`, `npm run test:browser:hr-team`, and `npm test`. The HR Team CI job invokes the structure smoke, so these assertions are part of the exact-SHA CI gate. No product code, HR API, access rule, or release marker changed; no version bump or deploy is required for this test/documentation-only change.
- A fresh read-only access-profile check found the isolated QA account still Park active/default and Dar inactive with the approved minimal projection. The private membership fingerprint matched the pre-activation receipt. No account/staff identifiers or credentials are retained in this proof.
- The test-bearing feature commit is `afacbe595f2be3e91ed57b925dd4f6b2ccac264a`; its [exact-SHA CI run](https://github.com/rainbowrainbowrainbow/8223324090/actions/runs/36346524751) completed with all 8/8 jobs green, including HR Team browser smoke. This documentation follow-up changes no product or test code; its final SHA and CI result are recorded in the task handoff. Neither commit is deployed to production, and the synthetic test does not claim a new live late-response observation.
