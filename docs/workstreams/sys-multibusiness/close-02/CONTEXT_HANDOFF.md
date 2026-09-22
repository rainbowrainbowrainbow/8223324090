# SYS-MB-CLOSE-02 — context handoff

## Current role QA checkpoint — 2026-09-22 19:57 UTC

The exact owner-approved `SYS-MB-CLOSE-03-LIVE-ROLE-QA-20260922` run passed Maysternya/CRM role transitions and same-JWT revoke on the existing smoke account. Target memberships are now inactive; Park default is unchanged. Read [ROLE_QA_REPORT.md](../asset-close-01/ROLE_QA_REPORT.md). `observation.startUtc` remains null for the separately listed acceptance, enabled-cycle and telemetry gaps. The older telemetry/role blocker descriptions below are historical.

## Telemetry update after owner approval

The exact telemetry read grant is active and verified for the dedicated read-only role. Its private receipt and initial collector report are outside Git. Read [TELEMETRY_READ_GRANT_REPORT.md](../asset-close-01/TELEMETRY_READ_GRANT_REPORT.md). Observation is still NOT_STARTED for role/revoke live QA, unknown longest enabled cycle and incomplete measured entry-family coverage. Do not repeat the grant or count from the grant timestamp; retain exact revoke as an exit-gate cleanup obligation.

## Update after SYS-MB-ASSET-CLOSE-02

Current worktree: `C:\Users\Plotva\OneDrive\Документи\EventGenix\.worktrees\sys-mb-asset-close-01-20260922`. The four broken catalog `image_url` values were cleared through the approved API and passed live catalog QA. The current live and production-branch SHA is `ac6efaeb85b238f3eeb1cac7c9e0e8c5d024fe79 / v0.82.11`; no code deploy occurred for this repair. Read [ASSET_CLOSE_02_REPORT.md](../asset-close-01/ASSET_CLOSE_02_REPORT.md) and the updated `OBSERVATION_START.md` before SYS-MB-CLOSE-03. Observation remains NOT_STARTED for telemetry SELECT `42501`, unknown enabled cycle and incomplete live role/domain acceptance. Do not treat the older asset-HOLD instructions below as current state.

## Current checkpoint

- Worktree: `C:\Users\Plotva\OneDrive\Документи\EventGenix\.worktrees\sys-mb-close-02-release-20260922`
- Branch: `codex/sys-mb-close-02-release-20260922`
- Exact live SHA at final acceptance: `9822db02e748b451ec0a937071057a8aac802cac`
- Published version: `v0.82.10 — SYS-MB: каталог і timeline після cutover`
- Exact-SHA CI: https://github.com/rainbowrainbowrainbow/8223324090/actions/runs/35759994560
- Railway deployment ID: `d1bbbb30-2d12-43b2-ba18-57866deb1100`
- Rollback live SHA: `a34ee622402776ba23efda393d37d11868640120`
- Current remote branch after another stream: `20018b1e6fcfbb57484d405d495642d1745c0ff6`; it was not overwritten and was not yet the live SHA at the final check.

## Applied production state

- Owner repair: `APPLIED` from exact reviewed predicates.
- Maysternya cutover: `APPLIED`, receipt `0f3f673a59d63d1f161003dee8e24a01eccd12e0c227a887183a0d9a9bba755f`.
- CRM: do not replay; existing receipt authority `29436fa0daf1ae01bdfaf7bfaf48680cf92dd77e899b4adc4646555903a07223`.
- Park catalog ownership: `APPLIED`, receipt `d2fb93fc3cdc7521e8544b3db288441af8f8aa77f5b45c6be40556ad9f20ffd6`.
- Catalog mapping hash: `0ce0adbf5b372c443a716eabab1869f910d5af3025fb5f2a88ff175d9d310fb0`.
- Public tokens preserved: 3; rotated/generated: 0.
- QA fixtures created: 0; cleanup action: none.
- Observation: `NOT_STARTED_REQUIRED_ASSET_HOLD`.

## Verified behavior

- Maysternya timeline membership hotfix passes live.
- Creator/owner sees Park, Dar, Maysternya and CRM; smoke account remains Park-only.
- Required Maysternya page shells, cross-tab/history, keyboard, light/dark and 390/768/1440 pass.
- The only Maysternya 403 is contained `/api/chat/unread`; Hermes has no new MD/CRM rights.
- All nine reviewed catalogs exist and are owned by `event_genix`; 5 are active, 4 are inactive drafts.
- Three existing public viewers return the correct catalog and page count.

## Required next action

`PARK-CATALOG-ASSET-01` is the only newly proven functional HOLD:

- `122112`: three configured temporary-host page images return 404;
- `Торти`: one configured live-path page image returns 404.

Prepare a narrow asset remediation package that identifies reviewed durable replacement assets and all consumers. Obtain an explicit production content/data block before upload or updating the four page asset fields. Do not rotate tokens, republish catalogs, activate drafts or assign shared blobs by filename. Re-run the same three public viewers and zero-fixture proof afterward. Only then set a real observation `startUtc` and begin measured exit-gate counting.

## Evidence publication boundary

The reports in this worktree were updated after the release with actual apply/QA results. They are currently local evidence because `origin/codex/eventgenix-production` advanced after the SYS-MB deploy. Do not push them by overwriting the newer production branch; carry them forward by hunk in the next authorized candidate.
