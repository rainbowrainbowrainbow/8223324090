# SYS-MB-CLOSE-02 — production delivery report

Status: `HOTFIX_RELEASE_REQUIRED`

Generated: 2026-09-22

## Published release

- Production branch: `codex/eventgenix-production`
- Previous live SHA: `b3ea57bef3c6694fcc19be86011552ca2e97ed7c`
- Functional commit: `b05be34a44f0b370e7fcb5ff2177c72fa1220346`
- Prepared release commit: `8cd718bf084af574c2a654dd99202550c4cc7edd`
- Live SHA: `a34ee622402776ba23efda393d37d11868640120`
- Version: `0.82.9`
- Release label: `SYS-MB: Майстерня, каталоги та telemetry`
- Railway deployment ID: `80cbf5a3-a532-4b1c-badd-e0a9028fcad6`
- Exact-SHA CI: https://github.com/rainbowrainbowrainbow/8223324090/actions/runs/35732051360
- Controller: `EG-20260922T125259Z-8cd718bf`, successful on attempt 2.

The deploy used `npm run release:railway-up`; raw `railway up` was not used. Live `/api/version` still confirms the exact SHA, branch, version and label above.

## Schema and protected data operations

Migrations `368_catalog_ownership_cutover_journal.sql` and `369_multibusiness_compatibility_telemetry_v2.sql` are deployed and remain additive.

Under `SYS-MB-CLOSE-02-DATA-APPLY-20260922`:

- the bounded four-table SELECT lease was created, used for a complete `REPEATABLE READ READ ONLY` preflight and retired within its TTL;
- the preflight returned complete visibility with zero issues and no writable fallback;
- exact owner repair predicates matched and payload hash `d20cdf51fbf60377993f442cbeac8222b51b87a0748981e9511545c743b8b242` was applied;
- the active organization owner count changed from zero to one for the reviewed owner;
- `maysternya_doli` prepare/apply succeeded from the post-owner fingerprint `8b27234df3045dedb39aba9247a704527b356c2e636bf8eb49fc8a6333251b9e`;
- Maysternya receipt: `0f3f673a59d63d1f161003dee8e24a01eccd12e0c227a887183a0d9a9bba755f`;
- live profile evidence now exposes all four businesses to the reviewed owner while the smoke account remains Park-only;
- CRM cutover was not replayed. The authoritative existing receipt remains `29436fa0daf1ae01bdfaf7bfaf48680cf92dd77e899b4adc4646555903a07223`.

Fresh direct CRM journal verification remains HOLD because the bounded audit role has no SELECT on the cutover journal and writable credentials were not used as a read-only fallback.

## Release-blocking regressions found by the guarded apply and live QA

1. The exact nine-catalog mapping was rejected before mutation because the cutover validator accepted ASCII IDs only. One reviewed existing catalog uses a printable Unicode/space stable ID.
2. The published browser redirects the membership-authorized Maysternya timeline route to `/dashboard` because its private-surface guard still accepts only the legacy global `creator` role.

Functional hotfix commit `40377c62939690b3eb613abd62624274ff7271da` fixes only those two conditions and adds negative tests. Catalog ownership was not mutated after the validation failure.

## Verification of the hotfix candidate

- Node `22.23.1`, npm `10.9.8`: PASS.
- Catalog cutover tests: 7/7 PASS.
- Timeline context tests: 30/30 PASS.
- UI smoke: 1320/1320 PASS plus 4/4 code-splitting tests.
- `npm run test:sys-mb`: PASS.
- `npm run check:syntax`: PASS outside the Windows sandbox; the sandbox-only attempt failed uniformly with `spawnSync EPERM` before parsing.

The hotfix still needs a new exact controller authorization for push, exact-SHA CI and Railway helper deploy. After that deploy, the existing Red block can continue with catalog prepare/apply and safe live QA.

## Rollback

- Hotfix rollback: redeploy `a34ee622402776ba23efda393d37d11868640120` through the helper.
- Owner repair and Maysternya apply are durable reviewed states and are not automatically reverted.
- Any future catalog failure stops before or inside its transaction; post-apply correction must be receipt-bound and separately authorized.
