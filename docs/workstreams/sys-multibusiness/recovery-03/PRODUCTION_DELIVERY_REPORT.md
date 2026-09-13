# SYS-MB RECOVER-03 production delivery report

Status: READY_FOR_EXACT_OWNER_BLOCK
Generated: 2026-09-13
Production impact: yes

## Current state

- Production live SHA: `487e9e872cef1455627aa0d6d31a9ef2ce9d7211`
- Production live branch: `codex/eventgenix-production`
- Production live version: `0.81.154`
- Production base used for candidate: `487e9e872cef1455627aa0d6d31a9ef2ce9d7211`
- Candidate branch: `codex/sys-mb-recover-03-20260913`
- Candidate worktree: `C:\Users\Plotva\OneDrive\Документи\EventGenix\.worktrees\sys-mb-recover-03-20260913`
- First business planned for apply: `crm`
- Second business: `maysternya_doli` after CRM PASS and a separate fresh block.

## Local readiness

- PASS: `npx -y -p node@22 -p npm@10 -c "npm run check:runtime"` — Node 22.23.2 / npm 10.9.9
- PASS: `npx -y -p node@22 -p npm@10 -c "npm run check:migrations"` — Migration governance passed; SQL range 001-365
- PASS: `npx -y -p node@22 -p npm@10 -c "npm run test:sys-mb"` — legacy-containment 68, business-cabinets 84, lead-integrity 20, d05-domain-ownership 25 all passed
- PASS: `npx -y -p node@22 -p npm@10 -c "node --test tests/production-block-controller.test.js"` — 45/45 tests passed
- PASS: `BUSINESS_CUTOVER_LOCAL_POSTGRES_TEST=1 node tests/integration/business-cutover-journal-postgres.test.js under disposable local PostgreSQL` — 2/2 tests passed

## Production apply status

Not started. The exact auth/migration/data/release/QA owner block has not been granted for this CRM manifest yet.

## Current blocker

Fresh read-only production preflight for CRM and Maysternya was collected but incomplete because the active read-only credentials do not have the required SELECT coverage. Production apply must first receive a bounded read-lease or run an equivalent read-only preflight after deploying schema. Write credentials must not be used as a hidden read-only fallback.

## Evidence paths

- CRM release manifest: `docs/workstreams/sys-multibusiness/recovery-03/CRM_RELEASE_MANIFEST.md`
- Verification manifest: `docs/workstreams/sys-multibusiness/recovery-03/VERIFICATION_MANIFEST.json`
- Private approved CRM payload and preflight files remain outside Git under `C:/Users/Plotva/.eventgenix/sys-mb-recover-01-20260913`.

## Pending production steps after approval

1. Commit functional package and separate release version/cache/changelog update if not already committed locally.
2. Prepare/execute production block controller with `--protected-workflow sys-mb-auth-cutover`.
3. Push exact release SHA to `codex/eventgenix-production`.
4. Wait for required green CI on that exact SHA.
5. Deploy only through `npm run release:railway-up`.
6. Run fresh read-only preflight, then approved atomic CRM mapping apply.
7. Live QA CRM roles/domains/Park-Dar invariants/catalog public links.
8. Cleanup only registered QA fixtures.
9. Prepare separate fresh manifest and approval block for Maysternya.
