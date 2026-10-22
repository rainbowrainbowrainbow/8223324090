# EG-HR-16/17 — production release proof, 2026-10-16

Status: RELEASED; scoped live read-only QA PASS.

## Identity and authorization

- Authorization: current owner request to finish production/versioning/release; bounded block EG-HR-16-17-RELEASE, six hours / maximum three scoped attempts. One Railway deploy performed.
- Live / production Git SHA: `6aa01c6e76a4129492c2d85aa1847416aeb2e083`.
- Version: `0.82.97`, «HR: чеклісти та адаптація Парку».
- Branch: `codex/eventgenix-production`.
- Railway: `fortunate-appreciation` / `production` / `8223324090` (service UUID `3fb62d4c-2dc2-4701-8e2b-09ce16e188ee`).
- Deployment: `46d2a67c-dbb8-4d5b-ab66-6662ae8cc543`.
- Standard `release:railway-up` executed from clean detached release worktree with explicit RELEASE_DEPLOY_BRANCH. Helper version smoke passed exact SHA/branch/version with manifest metadata.
- Rollback reference: `746d8c5c26f4e3e890cfa1ec69a1bb3524a85744` / v0.82.96. Use the standard helper and its documented rollback/version guards; no force-push or DB repair.

## Git and CI

- Functional candidate: `a4b824a3bbe9d84aa997115088e10bf16d0a2f26`; production base merged normally, no history rewrite.
- Release commits: `150354817efd6b07e0a260b17e68be2289e864df`, `6aa01c6e76a4129492c2d85aa1847416aeb2e083` (preserved historical changelog text).
- Feature exact-SHA CI: https://github.com/rainbowrainbowrainbow/8223324090/actions/runs/38919945534 — 23/23 success.
- Production exact-SHA CI: https://github.com/rainbowrainbowrainbow/8223324090/actions/runs/38922650074 — 23/23 success.
- Failed browser attempts were diagnosed and retained: Task Center narrow sidebar layout, Education journey request-settle timeout, WebKit background timeline fetch during navigation. One failed-jobs retry per workflow succeeded on unchanged SHA. Assertions were not removed. Browser-test timing instability remains a separate observation, not claimed root-cause-fixed.
- Node 22.23.1 / npm 10.9.8. Product/merge full npm test passed; version consistency passed. Final release baseline and disposable PostgreSQL/browser coverage passed in CI. Local Docker daemon unavailable; no production mutation tests substituted.

## Ownership and data boundary

Human owner confirmed Park-only professions, checklist templates and progress. Fresh audit immediately before deploy at 2026-10-16T15:33:37Z used existing eventgenix_audit_ro in REPEATABLE READ READ ONLY and ROLLBACK.

Counts: professions 35; checklist items 93; checklist progress 7; assignments 264; staff 217; onboarding progress 7; templates 2; linked Park onboarding tasks 20. Item/assignment/onboarding orphans, invalid progress links and foreign onboarding task signals: zero. Ten SELECT statements validated with EXPLAIN.

No migrations, membership changes, grants/leases, account permissions or operational records were changed. No temporary access was created; retirement is not applicable.

## Actual live QA

Existing isolated Park test account, staff.view allowed, payroll.view and manage_accounts denied. Six exact new GETs returned success; the same GETs with Dar context returned 403. New payloads passed private-field masking checks; salary, payroll-profiles, account onboarding options and broader role-assignments stayed 403.

Real live dashboard and read-only workspace/onboarding rendered. Controlled GET interception tested 403, 500 and offline plus successful Retry for workspace and onboarding. Team → basic card, Today → basic card and Schedule GET/render passed. No HR writes attempted. Browser guard blocked the existing unrelated POST /api/wallet/daily-login; it was never sent to the server. Authentication was the only allowed POST category.

Evidence: `HR_PARK_CHECKLIST_ONBOARDING_LIVE_QA_2026-10-16.json` contains redacted boolean checks, no tokens, account/staff IDs, names or contacts.

Both late business-response directions were proved by deterministic browser tests in CI. This release did not activate Dar membership or repeat a real two-business session. Dar API denial on live is distinct from synthetic context-switch race proof.

## Remaining scope

No blocker remains for the six approved reads. Training/conditions, medical/account details, writes and unrelated HOLD routes remain outside this release. These local proof files are intentionally outside the deployed commit to retain exact Git/live SHA equality; the owner decision and tests are committed. Historical candidate handoff is preserved.
