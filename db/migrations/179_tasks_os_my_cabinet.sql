-- MIGRATION_KIND: schema
-- SAFETY: additive
-- ROLLBACK: Drop task_subtasks, task_user_preferences, new task/task_template columns and indexes only after confirming Tasks OS data is no longer needed.

ALTER TABLE tasks
    ADD COLUMN IF NOT EXISTS task_mode TEXT DEFAULT 'work',
    ADD COLUMN IF NOT EXISTS task_kind TEXT DEFAULT 'action',
    ADD COLUMN IF NOT EXISTS visibility TEXT DEFAULT 'team',
    ADD COLUMN IF NOT EXISTS workflow_state TEXT DEFAULT 'todo',
    ADD COLUMN IF NOT EXISTS remind_at TIMESTAMP,
    ADD COLUMN IF NOT EXISTS snoozed_until TIMESTAMP,
    ADD COLUMN IF NOT EXISTS last_notified_at TIMESTAMP,
    ADD COLUMN IF NOT EXISTS next_notification_at TIMESTAMP,
    ADD COLUMN IF NOT EXISTS evening_review_date DATE,
    ADD COLUMN IF NOT EXISTS focus_rank INTEGER DEFAULT 0,
    ADD COLUMN IF NOT EXISTS related_entity_type TEXT,
    ADD COLUMN IF NOT EXISTS related_entity_id TEXT,
    ADD COLUMN IF NOT EXISTS source_module TEXT,
    ADD COLUMN IF NOT EXISTS effort_minutes INTEGER;

UPDATE tasks
SET task_mode = COALESCE(NULLIF(task_mode, ''), 'work'),
    task_kind = COALESCE(NULLIF(task_kind, ''), 'action'),
    visibility = COALESCE(NULLIF(visibility, ''), 'team'),
    workflow_state = CASE
        WHEN COALESCE(NULLIF(workflow_state, ''), '') <> '' THEN workflow_state
        WHEN status = 'done' THEN 'done'
        WHEN status = 'archived' THEN 'archived'
        WHEN status = 'in_progress' THEN 'in_progress'
        ELSE 'todo'
    END,
    focus_rank = COALESCE(focus_rank, 0)
WHERE true;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_tasks_task_mode') THEN
        ALTER TABLE tasks ADD CONSTRAINT chk_tasks_task_mode
            CHECK (task_mode IN ('work','personal','private','system'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_tasks_task_kind') THEN
        ALTER TABLE tasks ADD CONSTRAINT chk_tasks_task_kind
            CHECK (task_kind IN ('action','reminder','followup','deep_work','checklist','routine','waiting','idea','decision'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_tasks_visibility') THEN
        ALTER TABLE tasks ADD CONSTRAINT chk_tasks_visibility
            CHECK (visibility IN ('team','me_only','private'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_tasks_workflow_state') THEN
        ALTER TABLE tasks ADD CONSTRAINT chk_tasks_workflow_state
            CHECK (workflow_state IN ('inbox','todo','in_progress','waiting','scheduled','done','archived'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_tasks_effort_minutes') THEN
        ALTER TABLE tasks ADD CONSTRAINT chk_tasks_effort_minutes
            CHECK (effort_minutes IS NULL OR effort_minutes > 0);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_tasks_owner_visibility_mode
    ON tasks(owner_user_id, visibility, task_mode)
    WHERE COALESCE(status, 'todo') NOT IN ('done','cancelled','archived');

CREATE INDEX IF NOT EXISTS idx_tasks_workflow_state
    ON tasks(workflow_state);

CREATE INDEX IF NOT EXISTS idx_tasks_focus_rank
    ON tasks(owner_user_id, focus_rank)
    WHERE COALESCE(focus_rank, 0) > 0;

CREATE INDEX IF NOT EXISTS idx_tasks_next_notification
    ON tasks(next_notification_at)
    WHERE next_notification_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS task_subtasks (
    id SERIAL PRIMARY KEY,
    task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    is_done BOOLEAN DEFAULT false,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW(),
    completed_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_task_subtasks_task_id
    ON task_subtasks(task_id, sort_order, id);

CREATE TABLE IF NOT EXISTS task_user_preferences (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    focus_limit INTEGER DEFAULT 3,
    digest_mode TEXT DEFAULT 'important_only',
    default_task_mode TEXT DEFAULT 'personal',
    default_privacy TEXT DEFAULT 'me_only',
    show_private_in_tasks_page BOOLEAN DEFAULT false,
    enable_telegram_reminders BOOLEAN DEFAULT true,
    enable_evening_review BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(user_id)
);

CREATE INDEX IF NOT EXISTS idx_task_user_preferences_user_id
    ON task_user_preferences(user_id);

ALTER TABLE task_templates
    ADD COLUMN IF NOT EXISTS template_kind TEXT DEFAULT 'task',
    ADD COLUMN IF NOT EXISTS default_task_mode TEXT DEFAULT 'work',
    ADD COLUMN IF NOT EXISTS default_task_kind TEXT DEFAULT 'action';
