# HR ownership local candidate — 2026-10-23

Status: LOCAL_IMPLEMENTATION; NOT APPROVED FOR PRODUCTION MIGRATION OR DEPLOY.

Authorization: EG-HR-OWNERSHIP-LOCAL-IMPLEMENT. Base: fc70fd414f2c9ef394db997cec6e8858a4d6d7c5 (v0.82.115). This is an additive six-table candidate, not a second-business rollout.

## Implementation and access boundary

Migration 387 adds nullable business/organization pairs, registry foreign keys, owner indexes, same-owner parent constraints and owner validation to hr_professions, hr_profession_checklist_items, hr_staff_profession_checklist_progress, staff_role_assignments, onboarding_templates and onboarding_progress. Existing global unique keys remain. No row is attributed by the migration. Missing ownership remains invisible to application queries.

Six updatable `hr_owned` security-barrier views restrict ordinary application queries to the active Park registry identity. These are explicit application query boundaries, not database-role security or RLS. Direct database access is not made tenant-safe by a view; operators retain their existing authority. Scoped writers explicitly insert Park owner IDs. Conflicting unowned/foreign assignment or progress upserts fail closed rather than adopt records. Existing privileged deletion-readiness counters deliberately inspect all dependencies, including unowned rows, so they cannot incorrectly authorize deletion; they are not Park recovery GET projections.

The existing six recovery GET allowlists, active single-business membership, business/organization identity checks and staff.view capability are preserved. Payroll/account permissions, sessions and memberships are unchanged. Schedule/training/payroll sources outside these six tables are not declared multi-tenant. The minimal recovery projections remain separate from privileged legacy operations.

Task-count queries aggregate in lateral subqueries because a PostgreSQL view does not inherit a table primary key's GROUP BY functional dependency. Dashboard grouping explicitly includes selected owned-view columns.

## Backfill preparation and rollback

`scripts/prepare-park-hr-ownership-backfill.cjs --plan --inventory <private-file> --registry-receipt <private-file> --out <private-file>` prepares a private, count/hash-bound plan only. It has no production apply command. Output must stay outside Git. Freeze all six tables' structural keys/links, including profession key; the earlier inventory must be refreshed before any future operation. Names, contacts and credentials are not inventory fields.

Disposable-only apply/rollback helpers require verified loopback test targets, lock all six relations and use one transaction. They reject inventory drift and foreign ownership, record exactly changed rows, support idempotent retry and rollback child-first. A test injects a mid-operation failure. These helpers must not be repurposed as a production command.

Production gates: separately review actual migration SQL; confirm fresh exact inventory and owner decision; inspect constraints against all legacy links; prepare an explicitly authorized bounded backfill and private receipt. Coordinate a writer handoff: old binaries can still create NULL-owner rows. No traffic cutover until an approved final delta audit proves every intended row owned. New owned writers must not run before the additive schema and attribution are ready. Keep the preceding binary as rollback reference; clearing ownership requires a separately reviewed inventory-bound rollback, never broad cleanup. No NOT NULL or global-key removal is included.

Backup recovery disables user triggers during dependency-ordered restore and restores their modes afterwards; the new foreign keys enter the normal catalog. Disposable recovery compatibility remains a required gate, not an assumed production guarantee.

## Verification

Results and exact feature CI are recorded in the final handoff after execution. No production schema, business record, role, grant or membership was changed by this candidate. No application deploy is authorized by this block.

## Separate live QA finding

The one EG-HR-PROOF-AND-QA-FINALIZE fixture ran on live v0.82.114 / 49dc3ebb8a6bd08cd46143e1514d7f937d7b5520. Park structure loaded without Retry, actual sidebar selection reached Dar, and Dar structure GET returned 403. The return selector was unavailable before Park could be selected. This proves an incomplete browser scenario, not yet the root cause of a product defect. No live delayed-response assertion was reached.

The temporary membership was active for 35 seconds (2026-10-23T18:44:19Z–18:44:53Z); authenticated deletion, audit event, initial membership fingerprint and Park-only single profile were confirmed. No second activation is authorized. Browser mutation interception blocked one attempted product write. No deploy or DB lease occurred.

Production Git test/docs/CI integration: 63c1aef75888122e46af6913e62d49a202d90610, CI 23/23: https://github.com/rainbowrainbowrainbow/8223324090/actions/runs/40002682649. Feature CI also 23/23 after an install-only retry: https://github.com/rainbowrainbowrainbow/8223324090/actions/runs/39998392363. Live SHA intentionally differs because this block excludes deploy. Full real-switch QA remains HOLD; preserve the earlier deterministic race evidence separately.

### Executed local evidence

Node 22.23.1 / npm 10.9.8. Disposable PostgreSQL 16 on a dedicated loopback Docker container, never the production database:

- Fresh startup migration contract: 1/1.
- Profession onboarding/vacancy hire: 1/1.
- Transactional account onboarding, including membership-backed access status: 23/23.
- New ownership integration: 5/5; all six real Express GET lanes, registry/membership negatives, private-field masking, owner constraints, migration replay, conflict rejection, interrupted backfill, retry and rollback.
- Full backup v2 plain/encrypted restore into a separate clean PostgreSQL database: 1/1.
- Focused route/button contracts: 139/139. Existing behavior assertions retained; SQL mock dispatch updated for qualified tables and lateral task aggregation.

The tests exposed and fixed the view GROUP BY incompatibility; test fixture omissions and parameter casts were corrected without relaxing assertions. Existing unknown-owner fixtures are not silently attributed in runtime code. Only synthetic startup fixtures receive explicit ownership inside the verified isolated runner.

A later read-only check at 2026-10-23T19:04:35Z reconfirmed live v0.82.114 / 49dc3ebb8a6bd08cd46143e1514d7f937d7b5520, exact restored membership fingerprint, inactive Dar, Park default and Park-only single scope. Both registry businesses use membership mode. The missing return selector's cause remains unproven; no product/auth fix or repeated membership activation was performed.

Additional privileged consumers outside this change still read legacy base tables: auth/users/training, payroll/attendance/shift services and staff display groups. They receive no new access here. This candidate does not claim those domains are tenant-isolated; review them before any future second-business namespace enablement. Startup legacy seeds and old binaries remain part of the separately approved writer-handoff gate.

### Candidate integration and diagnostic distinction

Product implementation commit: 48fd0cc31. Ordinary merge of production Git 63c1aef75888122e46af6913e62d49a202d90610: b765a01d9. Only the unit test file list conflicted; both ownership and browser synchronization tests were retained. Production release markers remain v0.82.115. This feature must not be promoted before the separately approved schema/backfill/writer handoff.

A disposable actual-app browser diagnostic with a synthetic two-business account completed Dar to Park successfully. This is not live QA and does not establish the cause of the live selector timeout. The live finding remains an incomplete scenario, not a proven shared auth defect. No new production fixture was activated.

Full local baseline was restarted after merge resolution so an intermediate conflicted manifest is not treated as a test result. Exact final CI evidence is delivered in the accompanying handoff; no production deploy is included.

### CI integration corrections

The first feature CI exposed two integration issues: synthetic Park registry setup altered unrelated Education/permission prerequisites, and the staff-list onboarding CTE selected new owner columns without grouping them. Setup now excludes Education and permission suites; production auth/membership guards were not changed. The CTE groups owner IDs explicitly.

Checklist scale fixtures now explicitly attribute their 201 synthetic assignments. Legacy unbound checklist items remain a privileged reconciliation state for a known same-owner profession; the same-owner profession FK still rejects foreign linkage, while the six minimal recovery GETs exclude unbound items. No unknown real owner is inferred or backfilled.

Executed after these corrections: permission integration 11/11; ownership integration 5/5 (including foreign legacy-parent rejection); actual checklist browser/API/PostgreSQL PASS with four role cases, both themes, 201-row pagination, history and Training synchronization. Existing assertions remain. Full local npm test passed on the merged candidate before the final integration corrections; final exact-SHA CI is still required. The source-bound Education diagnostic could not run on this Windows host because its portable target requires loopback 5432, which Docker could not bind; it is not reported as a passing local test. A concurrent local schema-reset run also hit shared lock memory; the sequential rerun completed with verified cleanup. Neither limitation led to changing CI settings or assertions.

### Final fixture compatibility and private plan evidence

The second feature CI passed 22/23 jobs. Its only failure was an unowned synthetic onboarding row in the immutable KPI snapshot payroll test. Four payroll fixture files now explicitly set Park owner metadata for their synthetic professions, assignments and onboarding rows. No payroll runtime, rates, calculations, permission guards or snapshot assertions changed.

After this correction, the complete local payroll/finance isolated mode passed all 117 tests across 13 files, including dated conditions, immutable KPI snapshots, installments, reversal/settlement and finance reconciliation. Final ownership integration passed 5/5 again after adding pg_catalog verification of the observed primary keys. The checklist actual-app test remains PASS, including the 201-assignment scale case.

The full payroll mode was run with TZ=UTC, matching GitHub CI. The Windows host's Europe/Kyiv run exposed a date-parsing assumption in the unchanged attendance date normalizer (a local-midnight PostgreSQL DATE converted through toISOString can shift a day). This is not attributed to ownership or claimed as a production failure; non-UTC payroll/date portability needs separate owner review. No production timezone or protected date/payroll runtime was changed.

At 2026-10-23T19:44:53Z, eventgenix_audit_ro refreshed the six-table inventory in REPEATABLE READ READ ONLY and rolled back. Catalog primary keys are exactly id; counts remain 35 / 93 / 7 / 264 / 2 / 7. Every previously captured structural row matches; all seven parent-link violation aggregates are zero. Profession keys are now included. A complete private plan and inventory were created outside Git; the local private-path receipt is `%TEMP%/eg-hr-owner-latest-private-paths.json`. No credentials are stored in these files. Plan SHA-256: d55acad5345616fa3e8d1e4e34d433f2b18c3f8d7bfa3036266caeae43f5d721.

Zero parent-link violations are not standalone proof of Park ownership or permission to run a production backfill. The recorded Park owner decision, a fresh full staff provenance audit before cutover, review of the actual DDL/backfill/rollback, writer handoff and separate production authorization remain required. Production DDL/DML/grants during this block: zero. No second production QA activation occurred. Final exact-SHA CI and live/Git identities are provided in the final redacted handoff.

### Downstream full-stack fixture handoff

Before finalizing CI, the remaining actual-app stages were run locally. The HR pay suite creates its own authoritative registry, so its synthetic HR attribution now runs after that registry setup rather than in the generic runner; its assignments explicitly carry the synthetic Park owner IDs. No memberships, roles, payroll runtime or UI assertions were changed.

All three full-stack scripts passed: onboarding/hiring/Training/Schedule, membership-backed HR pay/attendance/salary masks and the finance workspace. Additional disposable downstream checks passed: admission 14/14, education series 18/18, education acceptance 11/11 with its required Playwright runtime, and banquet recovery 30/30. An initial local acceptance invocation omitted the ephemeral Playwright package; the correctly wrapped rerun passed without changing tests.

An unchanged Omni mobile-layout test failed once in the third feature CI with a 4px vertical viewport overflow; earlier feature runs passed it. No Omni rendering, layout or assertion is changed by this ownership candidate. The final exact-SHA run must still pass it, and any targeted infrastructure/flaky rerun must be recorded rather than hidden. No production deploy or additional live QA fixture is part of these test corrections.
