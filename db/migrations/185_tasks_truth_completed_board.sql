-- MIGRATION_KIND: mixed
-- SAFETY: Adds duplicate lineage metadata and non-destructively archives active duplicate tasks. No rows are deleted.
-- ROLLBACK: Restore rows with archive_reason='auto_duplicate' manually if needed, then drop idx_tasks_duplicate_of_task_id and duplicate_of_task_id.

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS archive_reason VARCHAR(80);
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS duplicate_of_task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_completed_at ON tasks(completed_at) WHERE completed_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_duplicate_of_task_id ON tasks(duplicate_of_task_id) WHERE duplicate_of_task_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_active_dedup_lookup
ON tasks (status, date, category, owner_user_id, source_type, source_id)
WHERE COALESCE(status, 'todo') NOT IN ('done','archived','cancelled');

WITH active AS (
    SELECT
        t.id,
        concat_ws('|',
            lower(regexp_replace(trim(COALESCE(t.title, '')), '\s+', ' ', 'g')),
            COALESCE(t.date::text, ''),
            lower(COALESCE(t.category, 'admin')),
            lower(COALESCE(t.subcategory, '')),
            COALESCE(t.owner_user_id::text, ''),
            lower(COALESCE(t.source_type, 'manual')),
            COALESCE(t.source_id::text, ''),
            COALESCE(t.template_id::text, ''),
            lower(COALESCE(t.source_entity_type, '')),
            COALESCE(t.source_entity_id::text, ''),
            COALESCE(t.pack_id::text, ''),
            lower(COALESCE(t.checklist_template_key, '')),
            COALESCE(t.afisha_id::text, '')
        ) AS signature
    FROM tasks t
    WHERE COALESCE(t.status, 'todo') NOT IN ('done','archived','cancelled')
      AND COALESCE(trim(t.title), '') <> ''
),
ranked AS (
    SELECT
        id,
        MIN(id) OVER (PARTITION BY signature) AS canonical_id,
        ROW_NUMBER() OVER (PARTITION BY signature ORDER BY id ASC) AS rn,
        COUNT(*) OVER (PARTITION BY signature) AS group_count
    FROM active
),
victims AS (
    SELECT id, canonical_id
    FROM ranked
    WHERE group_count > 1 AND rn > 1
)
UPDATE tasks t
SET status = 'archived',
    workflow_state = 'archived',
    archived_at = COALESCE(t.archived_at, NOW()),
    archive_reason = 'auto_duplicate',
    duplicate_of_task_id = victims.canonical_id,
    updated_at = NOW()
FROM victims
WHERE t.id = victims.id;
