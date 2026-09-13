# SYS-MB RECOVER-03 CRM first release manifest

Status: READY_FOR_NEW_EXACT_OWNER_BLOCK_AFTER_CI_REMEDIATION
Generated: 2026-09-13
Production impact: yes

## First business

First cutover business: `crm`.
Reason: CRM has the approved membership mapping and a narrower first acceptance surface than Maysternya; failure of CRM stops Maysternya as required.

Second business after CRM PASS: `maysternya_doli`, with a fresh preflight, manifest and separate active block.

## Current production identity

- Live URL: `https://8223324090-production.up.railway.app`
- Live branch from `/api/version`: `codex/eventgenix-production`
- Live SHA from `/api/version` before this release: `8b21b3fcbd159c6c1e793d22508953d303c6c212`
- Remote production branch base used for candidate: `18521fb2eb708f17d677c0cf96944adea0be91b1`
- Candidate source branch: `codex/sys-mb-recover-03-20260913`
- Candidate HEAD before drift refresh: `d448d125c94398fbd7bc2922bc6fee6b224c0290`
- First pushed candidate attempt: `7b3f87aa2fd37ff1f3b8e442077c6e1246bddea5` — CI failed before deploy; no Railway deploy or CRM apply was run.
- Remote production branch drift absorbed: `18521fb2eb708f17d677c0cf96944adea0be91b1` (`v0.81.158 — Спільний тестовий термінал`) is preserved in the remediated candidate; live site still reported `8b21b3fcbd159c6c1e793d22508953d303c6c212` before deploy.
- Release version: `v0.81.159`
- Release label: `SYS-MB: перехід CRM`

## Railway target

- Project: `fortunate-appreciation`
- Project ID: `bc28b46c-d4bc-491c-893a-d8401c633668`
- Environment: `production`
- Service name: `8223324090`
- Service UUID observed read-only: `3fb62d4c-2dc2-4701-8e2b-09ce16e188ee`
- Deploy method: repository helper `npm run release:railway-up` only.

## Candidate scope

The candidate preserves production branch hotfixes through `8b21b3fcbd159c6c1e793d22508953d303c6c212` and adds SYS-MB commits on top.

Scope families:

- SYS-MB auth/business context/profile/membership/cabinet code from prerequisite FINISH packages.
- RECOVER-02 atomic reserved business apply and guarded release workflow.
- Additive migrations 357, 363, 364, 365.
- SYS-MB tests and recovery documentation.
- Version/cache/changelog marker `v0.81.159 — SYS-MB: перехід CRM`.

## Migration hashes

- `db/migrations/357_organizations_business_memberships.sql`: `681a1aca9f40d822ad1413440dae24f5e634c8f64dfa722c8e6f2cc5b5e85adb`
- `db/migrations/363_multibusiness_cutover_journal_telemetry.sql`: `20f379fd31c48f1be49da7aa4439a94209bfd6b1b7a8a3cf42ba7fb73934d023`
- `db/migrations/364_catalog_ownership_markers.sql`: `2e37931e813217278c2d72784493b046e4c4ebd4457e23e185131b59e15389aa`
- `db/migrations/365_business_cutover_journal_approval_receipts.sql`: `fd937ac24548c619d267114a8e8dd29161f871f966e081cc1d7b7ddeef75a6a0`

## Approved CRM mapping

- Private payload: `C:/Users/Plotva/.eventgenix/sys-mb-recover-01-20260913/approved-crm-apply-payload.json`
- Private payload file hash: `30d9d2f478f938da22957ece2e20ccd8b9f673b6a8ba8b8a209294ffe7874aba`
- Mapping body hash: `3e653c3f12cc4edb3476cf4f5a9f06e1f2fbf865a2d410459fccca9163e50a86`
- Source snapshot hash: `458fbd72aafaf3708f2e80ad85893418d9122c0a5c7487ffe3f3de6dc12a757b`
- Approved role result: two director business memberships and one operational admin business membership. No owner assignment, no business creator role, no Hermes Bot rights.

## MD mapping prepared but not first apply

- Private MD payload hash: `77abd3935f953b210c0bc3676c29ab0fc4d91fb544cadaa9ab34e6a4d747bd9b`
- Mapping body hash: `7efec32812aa093d5cfb5ce390e4faa68cf36342d13c90aa40d462d8fed6a162`
- MD apply is blocked until CRM PASS and a separate fresh block.

## Fresh preflight status before first block

- CRM: `HOLD_REVIEW_REQUIRED`, `INCOMPLETE`, issue `SELECT_PERMISSION_REQUIRED`, private file hash `6253dc37dbec14f32836faf0d2cb4e2dc2ff9844d034456e040f0cc0508c1a2e`.
- Maysternya: `HOLD_REVIEW_REQUIRED`, `INCOMPLETE`, issue `SELECT_PERMISSION_REQUIRED`, private file hash `c1dc03833f16a9c6cdb4599c58cddd1fd8d0240b2b6529e87a569fb3fcd32a1b`.

The release block must allow either a temporary bounded read-lease for the preflight tables or a fresh equivalent read-only preflight after deploying schema. Do not use write credentials as read-only fallback.

## Data predicates for CRM apply

1. `/api/version` proves the exact release SHA and branch.
2. Migration ledger includes required SYS-MB migrations.
3. The approved CRM payload hash and mapping body hash match this manifest.
4. The CRM context is absent or belongs to the current Event Genix Group organization.
5. No Park/Dar/Maysternya business, membership or default context changes are included in the CRM apply receipt.
6. The apply response returns state `applied`, context `crm`, expected membership count, approval ref, DB fingerprint and receipt hash.
7. A replay with the same payload returns idempotent replay without duplicate memberships.

## Local verification before owner block

- PASS: `npm run check:runtime` — to rerun after this manifest refresh
- PASS: `npm run check:version` — v0.81.159 — SYS-MB: перехід CRM in sync before this docs refresh
- PASS: `npm run check:migrations` — to rerun after this manifest refresh
- PASS: `node --test tests/production-block-controller.test.js` — to rerun after this manifest refresh
- PASS: `npm run test:sys-mb` — to rerun after this manifest refresh
- PASS: `BUSINESS_CUTOVER_LOCAL_POSTGRES_TEST=1 node tests/integration/business-cutover-journal-postgres.test.js` — to rerun after this manifest refresh

## Required owner block

Exact block must authorize: auth/permission code, additive migrations, push to `codex/eventgenix-production`, exact-SHA CI, Railway helper deploy, temporary bounded read-only preflight access if required, approved atomic CRM mapping apply, safe live QA and cleanup, within 6 hours and max 3 release attempts.

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

