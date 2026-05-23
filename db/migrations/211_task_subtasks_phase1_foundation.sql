-- MIGRATION_KIND: schema
-- SAFETY: additive
-- ROLLBACK: Drop task_subtasks.source_type, task_subtasks.updated_at, and chk_task_subtasks_source_type only after exporting subtask source metadata if needed.

ALTER TABLE task_subtasks
    ADD COLUMN IF NOT EXISTS source_type TEXT DEFAULT 'manual',
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();

UPDATE task_subtasks
SET source_type = COALESCE(NULLIF(source_type, ''), 'manual'),
    updated_at = COALESCE(updated_at, created_at, NOW())
WHERE source_type IS NULL
   OR source_type = ''
   OR updated_at IS NULL;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_task_subtasks_source_type') THEN
        ALTER TABLE task_subtasks ADD CONSTRAINT chk_task_subtasks_source_type
            CHECK (source_type IN ('manual','template','ai','system'));
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_task_subtasks_source_type
    ON task_subtasks(source_type);
