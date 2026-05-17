-- MIGRATION_KIND: schema
-- SAFETY: Additive taxonomy, checklist-pack, dependency, and operational workflow fields only; existing task rows are not rewritten or inferred.
-- ROLLBACK: Drop the added indexes, task_dependencies, and the added task/task_template columns after confirming no operational pack data needs to be preserved.

ALTER TABLE tasks
    ADD COLUMN IF NOT EXISTS subcategory VARCHAR(64),
    ADD COLUMN IF NOT EXISTS checklist_template_key VARCHAR(64),
    ADD COLUMN IF NOT EXISTS source_entity_type VARCHAR(32),
    ADD COLUMN IF NOT EXISTS source_entity_id VARCHAR(120),
    ADD COLUMN IF NOT EXISTS pack_id UUID,
    ADD COLUMN IF NOT EXISTS pack_status VARCHAR(32),
    ADD COLUMN IF NOT EXISTS owner_role VARCHAR(64),
    ADD COLUMN IF NOT EXISTS sla_minutes INTEGER,
    ADD COLUMN IF NOT EXISTS escalate_after TIMESTAMPTZ;

ALTER TABLE task_templates
    ADD COLUMN IF NOT EXISTS subcategory VARCHAR(64),
    ADD COLUMN IF NOT EXISTS checklist_template_key VARCHAR(64),
    ADD COLUMN IF NOT EXISTS owner_role VARCHAR(64),
    ADD COLUMN IF NOT EXISTS sla_minutes INTEGER;

CREATE TABLE IF NOT EXISTS task_dependencies (
    id BIGSERIAL PRIMARY KEY,
    task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    depends_on_task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT now(),
    CONSTRAINT chk_task_dependencies_no_self CHECK (task_id <> depends_on_task_id),
    CONSTRAINT uq_task_dependencies_pair UNIQUE (task_id, depends_on_task_id)
);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_tasks_pack_status') THEN
        ALTER TABLE tasks ADD CONSTRAINT chk_tasks_pack_status
            CHECK (pack_status IS NULL OR pack_status IN ('draft','confirmed','in_production','ready','issued','cancelled'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_tasks_source_entity_type') THEN
        ALTER TABLE tasks ADD CONSTRAINT chk_tasks_source_entity_type
            CHECK (source_entity_type IS NULL OR source_entity_type IN ('booking','order','lead','customer'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_tasks_sla_minutes') THEN
        ALTER TABLE tasks ADD CONSTRAINT chk_tasks_sla_minutes
            CHECK (sla_minutes IS NULL OR sla_minutes > 0);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_tasks_taxonomy
    ON tasks(category, subcategory)
    WHERE COALESCE(status, 'todo') NOT IN ('done','cancelled','archived');

CREATE INDEX IF NOT EXISTS idx_task_templates_taxonomy
    ON task_templates(category, subcategory);

CREATE INDEX IF NOT EXISTS idx_tasks_pack_id
    ON tasks(pack_id)
    WHERE pack_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_source_entity
    ON tasks(source_entity_type, source_entity_id)
    WHERE source_entity_type IS NOT NULL AND source_entity_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_owner_role
    ON tasks(owner_role)
    WHERE owner_role IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_escalate_after
    ON tasks(escalate_after)
    WHERE escalate_after IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_task_dependencies_task
    ON task_dependencies(task_id);

CREATE INDEX IF NOT EXISTS idx_task_dependencies_depends_on
    ON task_dependencies(depends_on_task_id);
