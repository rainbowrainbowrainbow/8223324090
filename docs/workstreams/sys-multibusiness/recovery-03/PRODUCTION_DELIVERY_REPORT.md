# SYS-MB RECOVER-03 production delivery report

Status: READY_FOR_EXACT_OWNER_BLOCK
Generated: 2026-09-13
Production impact: yes

- Live SHA before release: `487e9e872cef1455627aa0d6d31a9ef2ce9d7211`
- Remote production branch base: `a06742e0d95ff286feff9bf79238cd1607b03412`
- Candidate branch: `codex/sys-mb-recover-03-20260913`
- Release version: `v0.81.156`
- Release label: `SYS-MB: перехід CRM`
- First business planned for apply: `crm`
- Second business: `maysternya_doli` after CRM PASS and a separate fresh block.

## Local readiness

- PASS: `npm run check:runtime` — Node 22.23.1 / npm 10.9.8
- PASS: `npm run check:version` — v0.81.156 — SYS-MB: перехід CRM in sync
- PASS: `npm run check:migrations` — Migration governance passed; SQL range 001-365
- PASS: `node --test tests/production-block-controller.test.js` — 45/45 tests passed
- PASS: `BUSINESS_CUTOVER_LOCAL_POSTGRES_TEST=1 node tests/integration/business-cutover-journal-postgres.test.js under disposable local PostgreSQL` — 2/2 tests passed
- PASS: `npm run test:sys-mb` — Passed before rebase: legacy-containment 68, business-cabinets 84, lead-integrity 20, d05-domain-ownership 25

## Production apply status

Not started. The exact auth/migration/data/release/QA owner block has not been granted for this CRM manifest yet.

## Current blocker

Fresh read-only production preflight for CRM and Maysternya was collected but incomplete because the active read-only credentials do not have the required SELECT coverage. Production apply must first receive a bounded read-lease or run an equivalent read-only preflight after deploying schema. Write credentials must not be used as a hidden read-only fallback.

## Evidence paths

- CRM release manifest: `docs/workstreams/sys-multibusiness/recovery-03/CRM_RELEASE_MANIFEST.md`
- Verification manifest: `docs/workstreams/sys-multibusiness/recovery-03/VERIFICATION_MANIFEST.json`
- Private approved CRM payload and preflight files remain outside Git under `C:/Users/Plotva/.eventgenix/sys-mb-recover-01-20260913`.
