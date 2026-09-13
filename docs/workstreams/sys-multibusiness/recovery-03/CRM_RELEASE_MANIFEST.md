# SYS-MB RECOVER-03 CRM first release manifest

Status: WAITING_FOR_EXACT_OWNER_BLOCK
Generated: 2026-09-13
Production impact: yes

## First business

First cutover business: `crm`.
Reason: CRM has the approved membership mapping and a narrower first acceptance surface than Maysternya; failure of CRM stops Maysternya as required.

Second business after CRM PASS: `maysternya_doli`, with a fresh preflight, manifest and separate active block.

## Current production identity

- Live URL: `https://8223324090-production.up.railway.app`
- Live branch from `/api/version`: `codex/eventgenix-production`
- Live SHA from `/api/version`: `487e9e872cef1455627aa0d6d31a9ef2ce9d7211`
- Live version: `0.81.154`
- Remote production SHA: `487e9e872cef1455627aa0d6d31a9ef2ce9d7211`
- Candidate source branch: `codex/sys-mb-recover-03-20260913`
- Candidate base: `487e9e872cef1455627aa0d6d31a9ef2ce9d7211`
- Candidate HEAD before RECOVER-02/03 functional commit: `8d516d6e6292621890874f422ebab6059856bd78`

## Railway target

- Project: `fortunate-appreciation`
- Project ID: `bc28b46c-d4bc-491c-893a-d8401c633668`
- Environment: `production`
- Service name: `8223324090`
- Service UUID observed read-only: `3fb62d4c-2dc2-4701-8e2b-09ce16e188ee`
- Deploy method: repository helper `npm run release:railway-up` only.

## Candidate scope

Changed paths count before final local commit: `305`.
Scope families:

- SYS-MB auth/business context/profile/membership/cabinet code from prerequisite FINISH packages.
- RECOVER-02 atomic reserved business apply and guarded release workflow.
- Additive migrations 363, 364, 365. Migration 357 is prerequisite schema and is expected to already be in candidate history from the SYS-MB prerequisite commit.
- SYS-MB tests and recovery documentation.
- Existing Design Board v0.81.154 production changes are preserved from current production base.

## Migration hashes

- `db/migrations/357_organizations_business_memberships.sql`: `681a1aca9f40d822ad1413440dae24f5e634c8f64dfa722c8e6f2cc5b5e85adb`
- `db/migrations/363_multibusiness_cutover_journal_telemetry.sql`: `20f379fd31c48f1be49da7aa4439a94209bfd6b1b7a8a3cf42ba7fb73934d023`
- `db/migrations/364_catalog_ownership_markers.sql`: `55cf238013b86069634cffe984e0c538ff469685586c653080a8ba06da478129`
- `db/migrations/365_business_cutover_journal_approval_receipts.sql`: `6a3078bb9d68efc08040800834827b3cd0e206ebaecd475edca116f456834f39`

## Approved CRM mapping

- Private payload: `C:/Users/Plotva/.eventgenix/sys-mb-recover-01-20260913/approved-crm-apply-payload.json`
- Private payload file hash: `30d9d2f478f938da22957ece2e20ccd8b9f673b6a8ba8b8a209294ffe7874aba`
- Mapping body hash: `3e653c3f12cc4edb3476cf4f5a9f06e1f2fbf865a2d410459fccca9163e50a86`
- Source snapshot hash: `458fbd72aafaf3708f2e80ad85893418d9122c0a5c7487ffe3f3de6dc12a757b`
- Snapshot source deployment SHA: `4214598e263057b1cb1524d7fb84f328031d288d`
- Membership writes expected by private summary: `3`
- Approved role result: two director business memberships and one operational admin business membership. No owner assignment, no business creator role, no Hermes Bot rights.

## MD mapping prepared but not first apply

- Private MD payload hash: `77abd3935f953b210c0bc3676c29ab0fc4d91fb544cadaa9ab34e6a4d747bd9b`
- Mapping body hash: `7efec32812aa093d5cfb5ce390e4faa68cf36342d13c90aa40d462d8fed6a162`
- MD apply is blocked until CRM PASS and a separate fresh block.

## Fresh preflight status before first block

Current read-only production preflight was executed for both contexts and stored privately:

- CRM: `HOLD_REVIEW_REQUIRED`, `INCOMPLETE`, issue `SELECT_PERMISSION_REQUIRED`, private file hash `6253dc37dbec14f32836faf0d2cb4e2dc2ff9844d034456e040f0cc0508c1a2e`.
- Maysternya: `HOLD_REVIEW_REQUIRED`, `INCOMPLETE`, issue `SELECT_PERMISSION_REQUIRED`, private file hash `c1dc03833f16a9c6cdb4599c58cddd1fd8d0240b2b6529e87a569fb3fcd32a1b`.
- Live schema currently has membership schema applied but cutover journal schema not applied.

This is the remaining technical blocker before data apply. The release block must allow either a temporary bounded read-lease for the preflight tables or a fresh equivalent read-only preflight after deploying schema. Do not use write credentials as read-only fallback.

## Data predicates for CRM apply

Apply may proceed only if all predicates are true after schema/code deploy:

1. `/api/version` proves the exact release SHA and branch.
2. Migration ledger includes required SYS-MB migrations.
3. The approved CRM payload hash and mapping body hash match this manifest.
4. The CRM context is absent or belongs to the current Event Genix Group organization.
5. No Park/Dar business, membership or default context changes are included in the CRM apply receipt.
6. The apply response returns state `applied`, context `crm`, expected membership count, approval ref, DB fingerprint and receipt hash.
7. A replay with the same payload returns idempotent replay without duplicate memberships.

## QA scope after CRM apply

Safe live QA only; no real sends, payments, exports, public token rotation, Telegram actions or generation.

Required checks:

- owner can see CRM business without changing Park/Dar default;
- directors can access CRM approved pages/actions;
- operational admin can access CRM as admin but is not owner/platform creator;
- worker/non-member denied;
- same-JWT revoke/role change takes effect on next request;
- business switching does not leak Park/Dar/MD data;
- public catalog links remain Park-owned and are not republished;
- compatibility telemetry observation starts after migration.

## Rollback

Rollback is forward-only:

- retain additive schema/evidence tables;
- use receipt-bound rollback package if CRM mapping must be undone;
- do not flip back to broad compatibility unless separately reviewed;
- do not drop deprecated columns/tables in this release.

## Required owner block

Exact block must authorize: auth/permission code, additive migrations, push to `codex/eventgenix-production`, exact-SHA CI, Railway helper deploy, temporary bounded read-only preflight access if required, approved atomic CRM mapping apply, safe live QA and cleanup, within 6 hours and max 3 release attempts.

## Local verification before owner block

- Candidate worktree: `C:\Users\Plotva\OneDrive\Документи\EventGenix\.worktrees\sys-mb-recover-03-20260913`
- Candidate branch: `codex/sys-mb-recover-03-20260913`
- Production base SHA: `487e9e872cef1455627aa0d6d31a9ef2ce9d7211`
- Candidate HEAD before functional local commit: `8d516d6e6292621890874f422ebab6059856bd78`
- Changed paths in release scope before local commit: `307`
- Checks:
  - PASS: `npx -y -p node@22 -p npm@10 -c "npm run check:runtime"` — Node 22.23.2 / npm 10.9.9
  - PASS: `npx -y -p node@22 -p npm@10 -c "npm run check:migrations"` — Migration governance passed; SQL range 001-365
  - PASS: `npx -y -p node@22 -p npm@10 -c "npm run test:sys-mb"` — legacy-containment 68, business-cabinets 84, lead-integrity 20, d05-domain-ownership 25 all passed
  - PASS: `npx -y -p node@22 -p npm@10 -c "node --test tests/production-block-controller.test.js"` — 45/45 tests passed
  - PASS: `BUSINESS_CUTOVER_LOCAL_POSTGRES_TEST=1 node tests/integration/business-cutover-journal-postgres.test.js under disposable local PostgreSQL` — 2/2 tests passed
- `routes/finance.js` and `routes/payroll.js` are allowed only inside the explicit `sys-mb-auth-cutover` workflow as SYS-MB containment; `routes/payments.js` remains blocked by regression test.
- Production apply remains blocked until the exact owner block authorizes the read-only preflight lease/equivalent preflight, migrations, push, CI, Railway helper deploy, approved CRM apply, safe QA and cleanup.
