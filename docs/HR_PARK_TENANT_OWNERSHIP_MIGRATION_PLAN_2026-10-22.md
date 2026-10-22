# Park HR tenant ownership — implementation decision required

Date: 2026-10-22. Status: PREPARED / NOT IMPLEMENTED.

## Problem and present guard

The legacy profession/checklist/onboarding tables do not contain authoritative business/organization ownership columns. Existing Park-only reads are protected by current single Park membership, matched IDs, staff.view and a human Park-only data-owner decision. This works for the approved recovery lane but is not a reusable multi-business model. Zero orphans is not ownership proof.

## Exact next implementation scope

1. Inventory exact columns, constraints, writers and joins for hr_professions, hr_profession_checklist_items, hr_staff_profession_checklist_progress, staff_role_assignments, onboarding_templates and onboarding_progress. Validate the existing Park staff owner decision separately. Do not assume unrelated training/rates/conditions have the same owner.
2. Resolve the active Park business and organization from the registry, never hardcode production UUIDs in a migration. Prepare a frozen aggregate inventory and reject non-Park signals or unexpected counts. Owner review must approve exactly which current rows may be attributed to Park.
3. Prepare an additive migration: nullable business_id/organization_id columns; composite foreign keys to the registry; same-owner constraints between profession, template, items and progress. Keys and uniqueness must be scoped by tenant where appropriate. Parent ownership is authoritative for child rows. Tasks keep their existing business_context contract until its separately reviewed registry migration.
4. Backfill only the approved inventory in a transaction, with matching active Park IDs and exact row-count checks. Refuse orphan, ambiguous or foreign links; do not guess ownership from linked account membership. No automatic assignment of account memberships.
5. Update all identified readers AND writers to tenant-bound IDs. Reads must fail closed for missing ownership; writes must derive owner from validated request context and reject cross-tenant parent/child pairs. Preserve the approved six exact GET allowlists and field projections. Never add a professions/* or staff/* exception.
6. Only after the application and existing rows pass isolation checks should a separately reviewed final migration add NOT NULL constraints. Rollout must remain compatible with the immediately preceding binary; do not combine unreviewed cleanup/drop actions.

## Required tests and release gates

Disposable PostgreSQL with Park and a synthetic second business in one organization plus a foreign organization: same profession keys must not cross-match; wrong parent owner, stale/revoked memberships, aggregate scope and cross-org IDs must fail. Verify rollback, interrupted backfill and idempotent retry. Assert payroll/medical/account projections remain excluded. Exercise checklist, dashboard, workspace and onboarding readers/writers without real production writes.

Before release: exact migration governance/classification, fresh aggregate owner proof, redacted inventory fingerprint, all writers accounted for, green exact-SHA CI, approved rollback mapping and test-account read QA. Any ambiguous owner means HOLD before backfill.

## Authorization needed

This proposal changes PostgreSQL schema, performs a bounded production data backfill and changes tenant-bound query contracts. It therefore requires separate exact approval under AGENTS.md protected schema/data/access rules. The generic closeout request does not grant those actions. No SQL, migration, role, membership, permission or business record was changed while preparing this plan.

The implementation task must name the six tables, exact approved inventory, Park target registry IDs kept privately, transaction and rollback procedure, migration files and release envelope before mutation. Registry SELECT grants are not authorized by this plan.
