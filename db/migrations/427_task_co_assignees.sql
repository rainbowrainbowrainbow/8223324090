-- MIGRATION_KIND: schema
-- SAFETY: Additive, idempotent table and index; existing task ownership is unchanged.
-- ROLLBACK: Revert application changes, then drop task_co_assignees after preserving any needed assignments.

CREATE TABLE IF NOT EXISTS task_co_assignees (
    task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    added_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (task_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_task_co_assignees_user_task
    ON task_co_assignees(user_id, task_id);
