# SYS-MB RECOVER-03 production delivery report

Status: READY_FOR_PUSH_AFTER_REBASE_TO_CURRENT_PRODUCTION
Generated: 2026-09-13
Production impact: yes
## Current refresh after Dashboard production drift

- Refreshed at: `2026-09-13T17:46:36Z`.
- Live before this SYS-MB deploy: `0c7c72e24961f69449b1aa78cac08f558df68e55` / `v0.81.163` / `Dashboard стабільні ризик-сигнали` on `codex/eventgenix-production`.
- Current remote production branch: `94c9966c0018c36931627343311f64b777d52ddd`.
- Candidate branch: `codex/sys-mb-recover-03-20260913`.
- Candidate head before final marker commit: `231ecd1c18a6b4c92b692bcdc2d64c288de66839`.
- Release marker prepared: `v0.81.165 — SYS-MB: перехід CRM`.
- Dashboard drift `94c9966c0018c36931627343311f64b777d52ddd` is preserved as production base; shared-terminal/payment drift is already in deployed/base history and is not modified by this SYS-MB marker.
- `/maysternya-doli` page registry now requires active business membership roles `director`, `manager`, or `admin`; technical platform `creator` is not treated as an MD business role.
- Local checks after the earlier candidate and before this final marker: `npm run check:runtime`, `npm run check:migrations`, policy/controller tests, `npm run test:browser:sidebar-timeline`, `npm run test:sys-mb`, and `npm test` passed. Targeted checks must be rerun after this final marker commit before push.

## Local readiness

- PASS: `npm run check:runtime` — to rerun after this manifest refresh
- PASS: `npm run check:version` — v0.81.165 — SYS-MB: перехід CRM in sync before this docs refresh
- PASS: `npm run check:migrations` — to rerun after this manifest refresh
- PASS: `node --test tests/production-block-controller.test.js` — to rerun after this manifest refresh
- PASS: `npm run test:sys-mb` — to rerun after this manifest refresh
- PASS: `BUSINESS_CUTOVER_LOCAL_POSTGRES_TEST=1 node tests/integration/business-cutover-journal-postgres.test.js` — to rerun after this manifest refresh

## Production apply status

Not started for this refreshed candidate. The previous exact block was superseded by production branch drift and must not be used for this SHA.

## Current blocker

Fresh read-only production preflight for CRM and Maysternya was collected earlier but incomplete because the active read-only credentials do not have the required SELECT coverage. Production apply must first receive a bounded read-lease or run an equivalent read-only preflight after deploying schema. Write credentials must not be used as a hidden read-only fallback.

## Evidence paths

- CRM release manifest: `docs/workstreams/sys-multibusiness/recovery-03/CRM_RELEASE_MANIFEST.md`
- Verification manifest: `docs/workstreams/sys-multibusiness/recovery-03/VERIFICATION_MANIFEST.json`
- Private approved CRM payload and preflight files remain outside Git under `C:/Users/Plotva/.eventgenix/sys-mb-recover-01-20260913`.

## CI attempt 1 remediation

Attempted exact-SHA CI: `34764487575` for `7b3f87aa2fd37ff1f3b8e442077c6e1246bddea5`.

Result: FAIL before deploy. Railway deploy and CRM mapping apply were not started.

Fixed local causes:

- `config/permissionRegistry.js`: keeps `/maysternya-doli` special-context access on active business membership roles `director`, `manager`, and `admin`; technical platform `creator` is not an operational MD role and explicit allow remains disabled.
- `tests/browser/sidebar-timeline-launcher-runtime-ci-smoke.js`: updated the read-only browser fixture to serve the canonical `/api/auth/business-profile` endpoint used by current frontend hydration.

Post-fix local verification:

- PASS: `node --test tests/account-access-policy.test.js tests/capability-parity-contract.test.js`
- PASS: `npm run test:browser:sidebar-timeline`
- PASS: `npm test`

A new exact owner block is required for the remediated candidate SHA after commit because the previous block was bound to `7b3f87aa2fd37ff1f3b8e442077c6e1246bddea5`.

