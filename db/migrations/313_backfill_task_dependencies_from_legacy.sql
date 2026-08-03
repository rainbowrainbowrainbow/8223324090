-- MIGRATION_KIND: data-fix
-- SAFETY: Idempotently copies only existing, non-self legacy dependency_ids into the canonical table when both tasks share a business context. It does not update or delete legacy data.
-- ROLLBACK: No automatic rollback. Canonical links can be removed through the task dependency API after operator review.
-- DATA_SCOPE: Existing tasks with legacy tasks.dependency_ids at migration time; missing, self-referential, and cross-business IDs are skipped.

INSERT INTO task_dependencies (task_id, depends_on_task_id)
SELECT source_task.id, legacy_dependency.depends_on_task_id
FROM tasks source_task
CROSS JOIN LATERAL unnest(COALESCE(source_task.dependency_ids, '{}'::int[]))
    AS legacy_dependency(depends_on_task_id)
JOIN tasks prerequisite_task
    ON prerequisite_task.id = legacy_dependency.depends_on_task_id
   AND COALESCE(prerequisite_task.business_context, 'event_genix') = COALESCE(source_task.business_context, 'event_genix')
WHERE source_task.id <> legacy_dependency.depends_on_task_id
ON CONFLICT (task_id, depends_on_task_id) DO NOTHING;
