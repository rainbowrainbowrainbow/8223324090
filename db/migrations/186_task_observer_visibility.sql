-- MIGRATION_KIND: schema
-- SAFETY: Adds a narrow task observer table for read/materials visibility. Existing task rows are not modified.
-- ROLLBACK: DROP TABLE IF EXISTS task_observers;

CREATE TABLE IF NOT EXISTS task_observers (
    task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    access_level VARCHAR(20) NOT NULL DEFAULT 'materials',
    added_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    PRIMARY KEY (task_id, user_id),
    CONSTRAINT task_observers_access_level_check CHECK (access_level IN ('watch', 'materials', 'full'))
);

CREATE INDEX IF NOT EXISTS idx_task_observers_user_id ON task_observers(user_id);
CREATE INDEX IF NOT EXISTS idx_task_observers_task_id ON task_observers(task_id);
