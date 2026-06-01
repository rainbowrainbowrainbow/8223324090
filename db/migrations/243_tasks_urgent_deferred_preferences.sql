-- MIGRATION_KIND: schema
-- SAFETY: Idempotent ADD COLUMN/CREATE INDEX changes only; existing task data is not updated or removed.
-- ROLLBACK: Drop the added task_user_preferences columns, constraints, and indexes if the feature is reverted.

ALTER TABLE task_user_preferences
    ADD COLUMN IF NOT EXISTS task_sound_enabled BOOLEAN DEFAULT true,
    ADD COLUMN IF NOT EXISTS task_sound_volume NUMERIC(4,3) DEFAULT 0.400,
    ADD COLUMN IF NOT EXISTS task_sound_theme TEXT DEFAULT 'subtle';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'task_user_preferences_task_sound_volume_check'
          AND conrelid = 'task_user_preferences'::regclass
    ) THEN
        ALTER TABLE task_user_preferences
            ADD CONSTRAINT task_user_preferences_task_sound_volume_check
            CHECK (task_sound_volume >= 0 AND task_sound_volume <= 1);
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'task_user_preferences_task_sound_theme_check'
          AND conrelid = 'task_user_preferences'::regclass
    ) THEN
        ALTER TABLE task_user_preferences
            ADD CONSTRAINT task_user_preferences_task_sound_theme_check
            CHECK (task_sound_theme IN ('rock', 'classic', 'subtle'));
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_tasks_business_urgent_due
    ON tasks (business_context, next_notification_at, escalate_after, id)
    WHERE priority = 'urgent'
      AND COALESCE(status, 'todo') NOT IN ('done','cancelled','archived');

CREATE INDEX IF NOT EXISTS idx_tasks_business_owner_snoozed_active
    ON tasks (business_context, owner_user_id, snoozed_until)
    WHERE snoozed_until IS NOT NULL
      AND COALESCE(status, 'todo') NOT IN ('done','cancelled','archived');

CREATE INDEX IF NOT EXISTS idx_tasks_business_owner_workload_active
    ON tasks (business_context, owner_user_id, priority, scheduled_start_at, snoozed_until, date, deadline)
    WHERE COALESCE(status, 'todo') NOT IN ('done','cancelled','archived');
