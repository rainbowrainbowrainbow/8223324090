# SYS-MB-CLOSE-02 — production delivery report

## Later approved live role QA — 2026-09-22

The exact `SYS-MB-CLOSE-03-LIVE-ROLE-QA-20260922` block performed only the registered smoke account's temporary Maysternya/CRM membership lifecycle on the already deployed `ac6efaeb85b238f3eeb1cac7c9e0e8c5d024fe79 / v0.82.11`. Six role updates, two deactivations and same-JWT denials passed; fresh read-back found no active target membership and unchanged Park default. No commit, push, migration or deploy occurred. See [ROLE_QA_REPORT.md](../asset-close-01/ROLE_QA_REPORT.md). Full exit-gate acceptance remains HOLD.


Status: `RELEASED_ASSET_REPAIR_PASS_OBSERVATION_HOLD`

## 2026-09-22 telemetry read-access addendum

The owner separately approved `SYS-MB-CLOSE-03-TELEMETRY-READ-20260922`. A column-level SELECT grant on 15 collector fields across two telemetry tables was applied to the existing dedicated read-only role; it has no table-level SELECT, additional readable columns or write privileges. The actual collector succeeded. Its first one-day lookback is `HOLD`, and observation has not started. No code commit, push, deploy, migration or business-data mutation occurred for this grant. The exact ACL/collector evidence and future revoke obligation are in [TELEMETRY_READ_GRANT_REPORT.md](../asset-close-01/TELEMETRY_READ_GRANT_REPORT.md).

## 2026-09-22 asset repair addendum

The separately approved `SYS-MB-ASSET-CLOSE-02-20260922` block cleared only four broken `image_url` references through the existing catalog page API. Mapping hash: `4040295a1fdc2cc7067ce8f9299c7b6cd6270c38d1633d19d8ddbe7de927844b`. Apply/verify observed versions `4→5`, `2→3`, `2→3`, `5→6` and page history. Nine roots and three public token hashes remained unchanged. The catalog receipt was re-read through a column-scoped SELECT lease and matched; the lease was revoked in 0.431 seconds.

This was a data-only repair, so no new commit, CI run or deploy occurred. Final live and remote production SHA: `ac6efaeb85b238f3eeb1cac7c9e0e8c5d024fe79`, branch `codex/eventgenix-production`, `v0.82.11 — Tasker + My Day UX`. The previous SYS-MB code-release and CI evidence below remains historical evidence, not the current live version. Full exact evidence is in [ASSET_CLOSE_02_REPORT.md](../asset-close-01/ASSET_CLOSE_02_REPORT.md). Compatibility observation remains HOLD pending collector read access and remaining live role/domain QA.

Generated: 2026-09-22T18:01:54Z

## Published hotfix

- Site: https://8223324090-production.up.railway.app
- Production branch: `codex/eventgenix-production`
- Previous live SHA: `a34ee622402776ba23efda393d37d11868640120`
- Authorized initial candidate: `677c74277dbfde756aef8908d1fbf9cc6b4f8db6`
- Functional hotfix commit: `40377c62939690b3eb613abd62624274ff7271da`
- Exact live release SHA: `9822db02e748b451ec0a937071057a8aac802cac`
- Version: `0.82.10`
- Release label: `SYS-MB: каталог і timeline після cutover`
- Exact-SHA CI: https://github.com/rainbowrainbowrainbow/8223324090/actions/runs/35759994560 — `success`
- Railway deployment ID: `d1bbbb30-2d12-43b2-ba18-57866deb1100`
- Production block: `EG-20260922T162051Z-677c7427`, manifest hash prefix `534d96fbaf89`.

`npm run release:railway-up` performed the deploy. Raw `railway up`, force-push and reset of another stream were not used. `npm run version:smoke` and `npm run release:timeline-proof` both confirmed the exact SHA, branch, version, release label, page asset versions and service-worker cache.

The release consumed the three authorized release attempts:

1. the canonical gate passed, then a local WSL Git SSL-backend mismatch stopped before push;
2. the canonical gate passed again, exact SHA was pushed and CI became green, then the WSL-to-Windows Railway wrapper failed before upload because it did not translate the helper's `/tmp` export path;
3. the native Windows helper deployed the already pushed, already green exact SHA and returned live version proof.

No attempt changed production before the successful helper upload. A temporary unpushed version commit was reverted before the second controller run so the release remained `0.82.10`; the final file diff remained inside the authorized manifest.

## Protected data operations

The previously approved owner repair and Maysternya cutover remain durable:

- organization owner repair: `APPLIED` from exact reviewed predicates;
- Maysternya receipt: `0f3f673a59d63d1f161003dee8e24a01eccd12e0c227a887183a0d9a9bba755f`;
- CRM was not replayed; its existing receipt authority remains `29436fa0daf1ae01bdfaf7bfaf48680cf92dd77e899b4adc4646555903a07223`.

After the hotfix became live, the exact nine-catalog mapping passed guarded prepare and atomic apply:

- mapping hash: `0ce0adbf5b372c443a716eabab1869f910d5af3025fb5f2a88ff175d9d310fb0`;
- prepare fingerprint: `c53dfe688540407f5670b392c19ba29b856a5bcf2e2202b68b455015d013a262`;
- apply receipt: `d2fb93fc3cdc7521e8544b3db288441af8f8aa77f5b45c6be40556ad9f20ffd6`;
- roots: 9; existing public tokens preserved: 3;
- direct children: 10 subcategories, 8 items, 9 settings, 17 pages, 9 page-history rows, 0 automations and 0 trend proposals;
- shared assets remained unassigned pending consumer-level ownership evidence.

No public token was generated, rotated or republished. Catalog active/inactive state and draft/ready status were preserved.

## Live acceptance result

The hotfix behavior passed:

- creator profile has one active owner organization and four switchable businesses;
- smoke account remains Park-only and is denied Maysternya;
- `/maysternya-doli?timelineView=animators` stays on the Maysternya route with the active membership context;
- required Maysternya page shells, history navigation, keyboard focus, cross-tab opening, light/dark mode and 390/768/1440 widths passed without horizontal overflow;
- the only Maysternya 403 is `/api/chat/unread`, matching the approved Hermes containment.

Catalog ownership and viewer identity passed, but content QA found four pre-existing broken image references:

- `122112`, inactive draft: page images 0, 1 and 2 return HTTP 404 from the existing external temporary asset host;
- `Торти`, active draft: page 0 image returns HTTP 404 from the live asset path.

All three existing public links return HTTP 200 and render the correct page count: `122112` = 3, `Торти` = 1, `Випускний` = 8. The current block did not authorize replacement uploads or production asset URL edits, so these 404s are retained as an explicit required HOLD.

## Concurrent production-branch drift

After this deploy, another stream advanced `origin/codex/eventgenix-production` to `20018b1e6fcfbb57484d405d495642d1745c0ff6`; its ancestry includes the `v0.82.11` Tasker release. Auto-deploy is disabled and live still reported the SYS-MB SHA above at the final check. This worktree was not reset, force-pushed or used to overwrite the newer branch state.

## Rollback

- Code rollback reference: `a34ee622402776ba23efda393d37d11868640120`, deployed only through the Railway helper.
- Additive migrations 368/369 and durable owner/Maysternya/catalog receipts stay in place during an application rollback.
- Any catalog correction must be a receipt-bound forward repair. Broad SQL, token rotation and automatic republication remain prohibited.
