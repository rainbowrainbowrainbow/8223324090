-- MIGRATION_KIND: schema
-- SAFETY: Adds opt-in completion and co-assignee delivery to the existing durable queue; no historical events are queued.
-- ROLLBACK: Roll back the API and consumer with 428 still applied. The legacy view excludes co-assignment and completion events, which remain queued for the compatible API.

-- Keep the original API on a writable view of primary assignments. Its
-- task-wide stale check and lease sweeper cannot see newer event types.
DO $$
BEGIN
    IF to_regclass('telegram_crm_delivery_outbox') IS NULL THEN
        ALTER TABLE telegram_crm_assignment_outbox RENAME TO telegram_crm_delivery_outbox;
    END IF;
END;
$$;

ALTER TABLE telegram_crm_delivery_outbox
    ADD COLUMN IF NOT EXISTS event_kind TEXT NOT NULL DEFAULT 'assignment',
    ADD COLUMN IF NOT EXISTS assignment_role TEXT NOT NULL DEFAULT 'primary',
    ADD COLUMN IF NOT EXISTS completion_at TIMESTAMP,
    ADD COLUMN IF NOT EXISTS assigner_user_id INTEGER;

CREATE OR REPLACE VIEW telegram_crm_assignment_outbox AS
SELECT id, task_id, owner_user_id, binding_version, status, attempts,
       created_at, available_at, lease_id, lease_expires_at, finished_at, reason, telegram_message_id
FROM telegram_crm_delivery_outbox
WHERE event_kind = 'assignment' AND assignment_role = 'primary';

CREATE INDEX IF NOT EXISTS telegram_crm_assignment_recipient_idx
    ON telegram_crm_delivery_outbox (task_id, owner_user_id, id DESC)
    WHERE event_kind = 'assignment';

CREATE UNIQUE INDEX IF NOT EXISTS telegram_control_completion_event_idx
    ON telegram_crm_delivery_outbox (task_id, owner_user_id, completion_at)
    WHERE event_kind = 'completion';

CREATE OR REPLACE FUNCTION queue_telegram_crm_assignment()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF NEW.owner_user_id IS NOT DISTINCT FROM OLD.owner_user_id THEN
            RETURN NEW;
        END IF;
        UPDATE telegram_crm_delivery_outbox
        SET status = 'cancelled', reason = 'assignment_changed', finished_at = NOW()
        WHERE task_id = NEW.id AND event_kind = 'assignment' AND assignment_role = 'primary'
          AND status IN ('pending', 'retry');
    ELSIF NEW.suppress_initial_telegram_assignment THEN
        RETURN NEW;
    END IF;
    IF NEW.owner_user_id IS NOT NULL
        AND COALESCE(NEW.status, 'todo') NOT IN ('done', 'completed', 'archived', 'cancelled', 'canceled', 'deleted') THEN
        INSERT INTO telegram_crm_delivery_outbox (task_id, owner_user_id, binding_version, assigner_user_id)
        SELECT NEW.id, b.user_id, b.version,
            CASE WHEN TG_OP = 'INSERT' THEN NEW.created_by_user_id
                 ELSE NULLIF(current_setting('eventgenix.task_assigner_id', true), '')::integer END
        FROM telegram_crm_bindings b
        JOIN users u ON u.id = b.user_id
        JOIN telegram_crm_settings s ON s.singleton AND s.mode IN ('read', 'write')
        WHERE b.user_id = NEW.owner_user_id AND b.pilot_enabled AND b.verified_at IS NOT NULL
            AND u.is_active IS DISTINCT FROM FALSE;
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION queue_telegram_crm_co_assignment()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        UPDATE telegram_crm_delivery_outbox
        SET status = 'cancelled', reason = 'assignment_changed', finished_at = NOW()
        WHERE task_id = OLD.task_id AND owner_user_id = OLD.user_id
          AND event_kind = 'assignment' AND assignment_role = 'co' AND status IN ('pending', 'retry');
        RETURN OLD;
    END IF;

    INSERT INTO telegram_crm_delivery_outbox
        (task_id, owner_user_id, binding_version, assigner_user_id, assignment_role)
    SELECT t.id, b.user_id, b.version, NEW.added_by, 'co'
    FROM tasks t
    JOIN telegram_crm_bindings b ON b.user_id = NEW.user_id
    JOIN users u ON u.id = b.user_id
    JOIN telegram_crm_settings s ON s.singleton AND s.mode IN ('read', 'write')
    WHERE t.id = NEW.task_id AND t.owner_user_id IS DISTINCT FROM NEW.user_id
      AND COALESCE(t.status, 'todo') NOT IN ('done', 'completed', 'archived', 'cancelled', 'canceled', 'deleted')
      AND b.pilot_enabled AND b.verified_at IS NOT NULL AND u.is_active IS DISTINCT FROM FALSE;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER telegram_crm_co_assignment_trigger
AFTER INSERT OR DELETE ON task_co_assignees
FOR EACH ROW EXECUTE FUNCTION queue_telegram_crm_co_assignment();

CREATE OR REPLACE FUNCTION queue_telegram_control_completion()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    -- Ignore read-state backfills and old completions recorded during a reopen.
    IF NEW.read_at IS NOT NULL THEN RETURN NEW; END IF;
    INSERT INTO telegram_crm_delivery_outbox
        (task_id, owner_user_id, binding_version, event_kind, completion_at)
    SELECT NEW.task_id, b.user_id, b.version, 'completion', NEW.completed_at
    FROM tasks t
    JOIN telegram_crm_bindings b ON b.user_id = NEW.recipient_id
    JOIN users u ON u.id = b.user_id
    JOIN telegram_crm_settings s ON s.singleton AND s.mode IN ('read', 'write')
    WHERE t.id = NEW.task_id AND t.status = 'done' AND t.completed_at = NEW.completed_at
      AND b.pilot_enabled AND b.verified_at IS NOT NULL AND u.is_active IS DISTINCT FROM FALSE
    ON CONFLICT DO NOTHING;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER telegram_control_completion_trigger
AFTER INSERT ON task_control_completion_inbox
FOR EACH ROW EXECUTE FUNCTION queue_telegram_control_completion();
