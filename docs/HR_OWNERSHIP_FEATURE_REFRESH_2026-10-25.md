# HR ownership candidate refresh — 2026-10-25

Status: PREPARED FOR NEW EXACT-SHA CI. No production cutover is authorized by this feature task.

- Feature: `codex/hr-tenant-ownership-20261023`.
- Refreshed production Git base: `b8e842cf4053713c0006f9e96c56ab55cef317b6`, v0.82.118, «Відновлено підтвердження аніматора в Telegram».
- Ordinary merge commit: `49da3ec269435d99d78478c7bae8c41510d370ef`.
- Previous HR candidate: `a073f8331767a287b20661584ade1106d2b7d0be`, historical green CI https://github.com/rainbowrainbowrainbow/8223324090/actions/runs/40147736871 (23/23).
- New HR candidate version: v0.82.119, «HR Парку: ізоляція професій та онбордингу». Final SHA and CI are recorded after feature push.
- Last live observed during refresh: v0.82.117 / `34293c9b1e52ac1e3b4f9bde6262276e0bf0e19b`. Git/live do not yet match because Telegram's production Git release has not been observed on live.

## Merge and release hygiene

The only merge conflicts were release markers in package.json, CHANGELOG.md, index.html and the tooling-owned Checkbox package markers. They were resolved to production Telegram v0.82.118 before the separate HR patch bump. Telegram server code, its startup/Omni tests and release-notes JSON were checked byte-for-byte against production. The HR operator test registration remained present. Old HR v0.82.118 was an unpublished feature candidate; its commits remain in history, while active changelogs now retain Telegram v0.82.118 followed by HR v0.82.119.

The scope remains migration 387, six-table explicit Park ownership, owned reads/writers and receipted maintenance/recovery. No new HR allowlist, account/membership permission, payroll field or production setting is introduced. Migration SHA-256 remains `0b5f3cd7fbc80dd966f3f7a6f2dc890b011ed1b7165536f766c821f5fe4d2a97`.

## Verification and upstream CI evidence

Focused merged Telegram/Omni/ownership tests passed 61/61. Version/release tooling and a new full exact-SHA CI are required after the patch bump.

The production-base CI https://github.com/rainbowrainbowrainbow/8223324090/actions/runs/40193642237 failed: many jobs could not upload required evidence because GitHub reported Artifact storage quota has been hit. One Education acceptance test also timed out waiting for a hidden display-settings selector. These failures predate this refresh. Do not assume they disappeared or that they were caused by HR; the new feature CI must establish the current result. Do not disable uploads/assertions or change CI settings to conceal a failure. No artifacts, runs, settings or budgets were deleted/changed by this task.

## Open production gates

Read `HR_OWNERSHIP_MAINTENANCE_LOCAL_HANDOFF_2026-10-25.md` and the historical candidate preflight. A fresh ownership/inventory audit and new exact authorization are required for any registry lease, schema/attribution, writer stop/restart, production integration/deploy and reviewed recovery. Retired leases cannot be reused. Unknown upload/image or receipt-storage recovery must be covered before shutdown. Real Dar -> Park live QA is still separate from synthetic evidence. No membership fixture is authorized here.

Feature commits/push and CI only. Main checkout and other worktrees remain untouched.
