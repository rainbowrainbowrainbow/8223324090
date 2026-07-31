-- MIGRATION_KIND: schema
-- SAFETY: Additive and idempotent preference fields only. Existing users receive an empty saved-view list and revision 0; no task data is changed or removed.
-- ROLLBACK: Keep the additive fields during application rollback. If the feature is permanently removed after exporting or intentionally discarding saved views, drop the named constraint and both added columns.

ALTER TABLE task_user_preferences
    ADD COLUMN IF NOT EXISTS saved_task_views JSONB NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS saved_task_views_revision INTEGER NOT NULL DEFAULT 0;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'task_user_preferences_saved_task_views_array_check'
          AND conrelid = 'task_user_preferences'::regclass
    ) THEN
        ALTER TABLE task_user_preferences
            ADD CONSTRAINT task_user_preferences_saved_task_views_array_check
            CHECK (jsonb_typeof(saved_task_views) = 'array');
    END IF;
END $$;
