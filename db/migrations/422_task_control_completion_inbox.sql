-- MIGRATION_KIND: schema
-- SAFETY: Adds an idempotent inbox and row trigger. Existing tasks and alerts are not rewritten at migration time.
-- ROLLBACK: Restore the prior app and disable task_control_completion_trigger if needed. Keep the inbox for recovery.

CREATE TABLE IF NOT EXISTS task_control_completion_inbox (
    recipient_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    business_context TEXT NOT NULL,
    completed_at TIMESTAMP NOT NULL,
    read_at TIMESTAMPTZ,
    PRIMARY KEY (recipient_id, task_id, completed_at)
);

CREATE INDEX IF NOT EXISTS idx_task_control_completion_page
    ON task_control_completion_inbox (recipient_id, business_context, completed_at DESC, task_id DESC);

CREATE INDEX IF NOT EXISTS idx_tasks_control_author
    ON tasks (created_by_user_id, business_context) WHERE COALESCE(visibility, 'team') = 'team';

CREATE INDEX IF NOT EXISTS idx_tasks_control_legacy_author
    ON tasks (created_by, business_context)
    WHERE created_by_user_id IS NULL AND COALESCE(visibility, 'team') = 'team';

CREATE OR REPLACE FUNCTION record_task_control_completion()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    completed tasks%ROWTYPE;
BEGIN
    IF TG_OP = 'UPDATE' AND OLD.status = 'done' THEN
        IF NEW.status = 'done' THEN
            RETURN NEW;
        END IF;
        completed := OLD;
    ELSIF NEW.status = 'done' THEN
        completed := NEW;
    ELSE
        RETURN NEW;
    END IF;

    IF COALESCE(completed.visibility, 'team') <> 'team'
       OR COALESCE(completed.task_mode, 'work') IN ('personal', 'private')
       OR completed.completed_at IS NULL THEN
        RETURN NEW;
    END IF;

    INSERT INTO task_control_completion_inbox (recipient_id, task_id, business_context, completed_at)
    SELECT u.id, completed.id, COALESCE(completed.business_context, 'event_genix'), completed.completed_at
    FROM users u
    WHERE (u.id = completed.created_by_user_id
           OR (completed.created_by_user_id IS NULL AND u.username = completed.created_by))
      AND COALESCE(u.is_active, TRUE)
      AND u.role IS DISTINCT FROM 'guest'
      AND CASE WHEN completed.owner_user_id IS NOT NULL THEN completed.owner_user_id <> u.id
          ELSE COALESCE(completed.assigned_to IN (u.username, u.name), FALSE) IS FALSE
           AND COALESCE(completed.owner IN (u.username, u.name), FALSE) IS FALSE END
    ON CONFLICT (recipient_id, task_id, completed_at) DO NOTHING;

    RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER task_control_completion_trigger
AFTER INSERT OR UPDATE OF status ON tasks
FOR EACH ROW EXECUTE FUNCTION record_task_control_completion();
