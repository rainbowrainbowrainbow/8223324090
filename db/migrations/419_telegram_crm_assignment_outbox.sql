-- MIGRATION_KIND: schema
-- SAFETY: Adds a Telegram CRM delivery queue and an assignment trigger. No historical tasks are enqueued.
-- ROLLBACK: Roll back the consumer and API, then drop the trigger if necessary. Keep the queue and its delivery evidence.

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS suppress_initial_telegram_assignment BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS telegram_crm_assignment_outbox (
    id BIGSERIAL PRIMARY KEY,
    task_id INTEGER NOT NULL,
    owner_user_id INTEGER NOT NULL,
    binding_version BIGINT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'sending', 'retry', 'sent', 'cancelled', 'expired', 'blocked', 'uncertain')),
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    lease_id UUID,
    lease_expires_at TIMESTAMPTZ,
    finished_at TIMESTAMPTZ,
    reason TEXT,
    telegram_message_id BIGINT CHECK (telegram_message_id > 0),
    CHECK ((status = 'sent') = (telegram_message_id IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS telegram_crm_assignment_outbox_ready_idx
    ON telegram_crm_assignment_outbox (available_at, id) WHERE status IN ('pending', 'retry');
CREATE INDEX IF NOT EXISTS telegram_crm_assignment_outbox_current_idx
    ON telegram_crm_assignment_outbox (task_id, id DESC);
CREATE INDEX IF NOT EXISTS telegram_crm_assignment_outbox_lease_idx
    ON telegram_crm_assignment_outbox (lease_expires_at) WHERE status = 'sending';
CREATE UNIQUE INDEX IF NOT EXISTS telegram_crm_assignment_outbox_token_idx
    ON telegram_crm_assignment_outbox (lease_id) WHERE lease_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS telegram_crm_notification_heartbeat (
    singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
    recipients JSONB NOT NULL,
    seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION queue_telegram_crm_assignment()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF NEW.owner_user_id IS NOT DISTINCT FROM OLD.owner_user_id THEN
            RETURN NEW;
        END IF;

        UPDATE telegram_crm_assignment_outbox
        SET status = 'cancelled', reason = 'assignment_changed', finished_at = NOW()
        WHERE task_id = NEW.id AND status IN ('pending', 'retry');
    ELSIF NEW.suppress_initial_telegram_assignment THEN
        RETURN NEW;
    END IF;

    IF NEW.owner_user_id IS NOT NULL
        AND COALESCE(NEW.status, 'todo') NOT IN ('done', 'completed', 'archived', 'cancelled', 'canceled', 'deleted') THEN
        INSERT INTO telegram_crm_assignment_outbox (task_id, owner_user_id, binding_version)
        SELECT NEW.id, b.user_id, b.version
        FROM telegram_crm_bindings b
        JOIN users u ON u.id = b.user_id
        JOIN telegram_crm_settings s ON s.singleton AND s.mode IN ('read', 'write')
        WHERE b.user_id = NEW.owner_user_id AND b.pilot_enabled AND b.verified_at IS NOT NULL
            AND u.is_active IS DISTINCT FROM FALSE;
    END IF;

    RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER telegram_crm_assignment_outbox_trigger
    AFTER INSERT OR UPDATE OF owner_user_id ON tasks
    FOR EACH ROW EXECUTE FUNCTION queue_telegram_crm_assignment();
