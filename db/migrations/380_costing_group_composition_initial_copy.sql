-- MIGRATION_KIND: data-fix
-- SAFETY: Copy existing costing group composition into append-only revision 1 after migration 377. Both inserts use unique-key conflict guards, update or delete no source rows, and run in one migration transaction.
-- ROLLBACK: Keep the copied immutable revision history and disable revision-based reads if recovery is needed; use a separately reviewed forward correction, never delete existing history.
-- DATA_SCOPE: Source costing_execution_groups and costing_group_members introduced by migration 376; destination costing_group_revisions and costing_group_revision_members introduced by migration 377. Across recorded business contexts, copy one initial revision per group and its included plan memberships only. No other tables are involved.

INSERT INTO costing_group_revisions (group_id, business_context, revision_number, reason, created_by, created_at)
SELECT id, business_context, 1, 'Initial composition from costing_group_members', created_by, created_at
FROM costing_execution_groups
ON CONFLICT (group_id, revision_number) DO NOTHING;

INSERT INTO costing_group_revision_members
    (revision_id, plan_id, business_context, include_plan_revenue, include_plan_direct_cost)
SELECT r.id, m.plan_id, m.business_context, m.include_plan_revenue, m.include_plan_direct_cost
FROM costing_group_revisions r
JOIN costing_group_members m ON m.group_id=r.group_id AND m.business_context=r.business_context
WHERE r.revision_number=1
ON CONFLICT (revision_id, plan_id) DO NOTHING;
