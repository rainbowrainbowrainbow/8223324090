-- MIGRATION_KIND: mixed
-- SAFETY: Additive task ownership/action-history schema plus conservative exact legacy owner normalization; no destructive updates.
-- ROLLBACK: Drop idx_task_action_history_task_created_at, idx_task_action_history_action_created_at, task_action_history, task owner_user_id indexes, and tasks.owner_user_id after accepting loss of typed task owner identity/history.

ALTER TABLE tasks
    ADD COLUMN IF NOT EXISTS owner_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;

COMMENT ON COLUMN tasks.owner_user_id IS
    'Canonical typed task owner for manager queue execution; assigned_to/owner remain legacy display or compatibility fields.';

CREATE INDEX IF NOT EXISTS idx_tasks_owner_user_id
    ON tasks(owner_user_id);

CREATE INDEX IF NOT EXISTS idx_tasks_status_owner_user_id
    ON tasks(status, owner_user_id)
    WHERE COALESCE(status, 'todo') NOT IN ('done', 'cancelled', 'archived');

UPDATE tasks t
SET owner_user_id = u.id
FROM users u
WHERE t.owner_user_id IS NULL
  AND t.assigned_to ~ '^[0-9]+$'
  AND t.assigned_to::integer = u.id;

WITH unique_usernames AS (
    SELECT username, MIN(id) AS id
    FROM users
    WHERE username IS NOT NULL AND username <> ''
    GROUP BY username
    HAVING COUNT(*) = 1
)
UPDATE tasks t
SET owner_user_id = u.id
FROM unique_usernames u
WHERE t.owner_user_id IS NULL
  AND t.assigned_to = u.username;

CREATE TABLE IF NOT EXISTS task_action_history (
    id BIGSERIAL PRIMARY KEY,
    task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    action_type TEXT NOT NULL,
    actor_user_id INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
    actor_name_snapshot TEXT NULL,
    source_surface TEXT NULL,
    old_value_json JSONB NULL,
    new_value_json JSONB NULL,
    meta_json JSONB NULL,
    summary TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_task_action_history_task_created_at
    ON task_action_history(task_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_task_action_history_action_created_at
    ON task_action_history(action_type, created_at DESC);
