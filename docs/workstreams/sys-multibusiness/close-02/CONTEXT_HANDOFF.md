# SYS-MB-CLOSE-02 — context handoff

## Current checkpoint

- Worktree: `C:\Users\Plotva\OneDrive\Документи\EventGenix\.worktrees\sys-mb-close-02-release-20260922`
- Branch: `codex/sys-mb-close-02-release-20260922`
- Current published SHA and production base: `a34ee622402776ba23efda393d37d11868640120`
- Functional hotfix commit: `40377c62939690b3eb613abd62624274ff7271da`
- Published version: `v0.82.9 — SYS-MB: Майстерня, каталоги та telemetry`
- Published CI: https://github.com/rainbowrainbowrainbow/8223324090/actions/runs/35732051360
- Railway deployment ID: `80cbf5a3-a532-4b1c-badd-e0a9028fcad6`

## Applied production state

- Bounded read-only preflight: PASS; leases retired.
- Owner repair: APPLIED from exact reviewed predicates.
- Maysternya cutover: APPLIED, receipt `0f3f673a59d63d1f161003dee8e24a01eccd12e0c227a887183a0d9a9bba755f`.
- CRM: do not replay; existing receipt authority is `29436fa0daf1ae01bdfaf7bfaf48680cf92dd77e899b4adc4646555903a07223`.
- Catalog cutover: NOT APPLIED; stopped before mutation by the published ASCII-only validator.
- QA fixtures: zero.
- Observation: not started.

## Hotfix scope

The hotfix contains only:

- printable Unicode/space support for already reviewed catalog IDs, still bounded to 50 characters with control-character rejection;
- membership-mode access to the private Maysternya timeline when the server-hydrated business profile has an active membership and the timeline module enabled;
- focused regression tests and sanitized CLOSE-02 evidence.

After exact push/CI/helper deploy, continue the existing Red data block with catalog prepare/apply for mapping hash `0ce0adbf5b372c443a716eabab1869f910d5af3025fb5f2a88ff175d9d310fb0`, then repeat public-link and Maysternya browser QA. Stop only the affected apply on hash, fingerprint or predicate drift.

## Remaining HOLD

- production hotfix authorization and delivery;
- exact catalog apply and post-apply proof;
- fresh CRM journal receipt verification through a safe read-only path;
- credential-limited role sessions and same-JWT revoke remain NOT_TESTABLE unless an already approved account/session exists;
- observation starts only after required live acceptance passes.
