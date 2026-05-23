-- MIGRATION_KIND: schema
-- SAFETY: Expands the task source entity whitelist to allow report handoff tasks. Existing tasks are preserved.
-- OPERATOR_APPROVAL: required
-- ROLLBACK: Drop chk_tasks_source_entity_type and recreate it without 'report' after resolving or exporting report-linked tasks.

ALTER TABLE tasks
    DROP CONSTRAINT IF EXISTS chk_tasks_source_entity_type;

ALTER TABLE tasks
    ADD CONSTRAINT chk_tasks_source_entity_type
        CHECK (source_entity_type IS NULL OR source_entity_type IN ('booking','order','lead','customer','report'));
