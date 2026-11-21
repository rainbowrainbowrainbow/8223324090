-- MIGRATION_KIND: schema
-- SAFETY: Queues opt-in edits only for recorded, delivered Telegram assignments when a task is newly cancelled. No backfill.
-- ROLLBACK: Roll back the API and worker, then remove the two cancellation triggers. The old worker cannot claim edit events.

ALTER TABLE telegram_crm_delivery_outbox
    ADD COLUMN IF NOT EXISTS original_delivery_id BIGINT;

CREATE UNIQUE INDEX IF NOT EXISTS telegram_crm_cancellation_original_idx
    ON telegram_crm_delivery_outbox(original_delivery_id)
    WHERE event_kind = 'cancellation';

CREATE OR REPLACE FUNCTION queue_telegram_cancellation_edits(p_task_id INTEGER, p_delivery_id BIGINT)
RETURNS VOID LANGUAGE sql AS $$
    INSERT INTO telegram_crm_delivery_outbox
        (task_id, owner_user_id, binding_version, event_kind, assignment_role, original_delivery_id)
    SELECT task_id, owner_user_id, binding_version, 'cancellation', assignment_role, id
    FROM telegram_crm_delivery_outbox
    WHERE task_id = p_task_id AND (p_delivery_id IS NULL OR id = p_delivery_id)
      AND event_kind = 'assignment' AND status = 'sent' AND telegram_message_id > 0
    ON CONFLICT DO NOTHING;
$$;

CREATE OR REPLACE FUNCTION queue_telegram_cancellation_on_task()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    PERFORM queue_telegram_cancellation_edits(NEW.id, NULL);
    RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER telegram_cancellation_on_task
AFTER UPDATE OF status ON tasks
FOR EACH ROW WHEN (NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM NEW.status)
EXECUTE FUNCTION queue_telegram_cancellation_on_task();

CREATE OR REPLACE FUNCTION queue_telegram_cancellation_on_ack()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    -- The API locks the task before updating the original delivery. A
    -- cancellation and its in-flight acknowledgement therefore serialize.
    IF EXISTS (SELECT 1 FROM tasks WHERE id = NEW.task_id AND status = 'cancelled') THEN
        PERFORM queue_telegram_cancellation_edits(NEW.task_id, NEW.id);
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER telegram_cancellation_on_ack
AFTER UPDATE OF status ON telegram_crm_delivery_outbox
FOR EACH ROW WHEN (NEW.event_kind = 'assignment' AND NEW.status = 'sent' AND OLD.status IS DISTINCT FROM NEW.status)
EXECUTE FUNCTION queue_telegram_cancellation_on_ack();
