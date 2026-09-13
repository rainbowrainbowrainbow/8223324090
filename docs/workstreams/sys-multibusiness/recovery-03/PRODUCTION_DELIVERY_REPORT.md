# SYS-MB RECOVER-03 production delivery report

Status: READY_FOR_NEW_EXACT_OWNER_BLOCK_AFTER_CI_REMEDIATION
Generated: 2026-09-13
Production impact: yes

- Live SHA before release: `8b21b3fcbd159c6c1e793d22508953d303c6c212`
- Remote production branch base: `18521fb2eb708f17d677c0cf96944adea0be91b1`
- Candidate branch: `codex/sys-mb-recover-03-20260913`
- Candidate HEAD before drift refresh: `d448d125c94398fbd7bc2922bc6fee6b224c0290`
- First pushed candidate attempt: `7b3f87aa2fd37ff1f3b8e442077c6e1246bddea5` — CI failed before deploy; no Railway deploy or CRM apply was run.
- Remote production branch drift absorbed: `18521fb2eb708f17d677c0cf96944adea0be91b1` (`v0.81.158 — Спільний тестовий термінал`) is preserved in the remediated candidate; live site still reported `8b21b3fcbd159c6c1e793d22508953d303c6c212` before deploy.
- Release version: `v0.81.159`
- Release label: `SYS-MB: перехід CRM`
- First business planned for apply: `crm`
- Second business: `maysternya_doli` after CRM PASS and a separate fresh block.

## Local readiness

- PASS: `npm run check:runtime` — to rerun after this manifest refresh
- PASS: `npm run check:version` — v0.81.159 — SYS-MB: перехід CRM in sync before this docs refresh
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

- `config/permissionRegistry.js`: restored technical `creator` to the `/maysternya-doli` special-context page preset while keeping the membership-context guard in `services/accountAccessPolicy.js`; explicit allow for this page remains disabled.
- `tests/browser/sidebar-timeline-launcher-runtime-ci-smoke.js`: updated the read-only browser fixture to serve the canonical `/api/auth/business-profile` endpoint used by current frontend hydration.

Post-fix local verification:

- PASS: `node --test tests/account-access-policy.test.js tests/capability-parity-contract.test.js`
- PASS: `npm run test:browser:sidebar-timeline`
- PASS: `npm test`

A new exact owner block is required for the remediated candidate SHA after commit because the previous block was bound to `7b3f87aa2fd37ff1f3b8e442077c6e1246bddea5`.

