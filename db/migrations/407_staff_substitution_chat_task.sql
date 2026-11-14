-- MIGRATION_KIND: schema
-- SAFETY: Adds direct chat task claim uniqueness and guards without updating existing records.
-- ROLLBACK: Keep the guards until active chat task substitutions are resolved.

CREATE UNIQUE INDEX IF NOT EXISTS uq_staff_substitution_chat_task_v402
    ON staff_substitutions(business_context,source_id)
    WHERE source_type='chat_task' AND state<>'cancelled';

CREATE OR REPLACE FUNCTION guard_staff_substitution_chat_task_v402()
RETURNS TRIGGER LANGUAGE plpgsql AS $function$
BEGIN
    IF TG_OP='UPDATE' THEN
        IF (NEW.id,NEW.channel_id,NEW.message_id,NEW.assigned_to,NEW.assigned_by,NEW.deadline)
            IS NOT DISTINCT FROM (OLD.id,OLD.channel_id,OLD.message_id,OLD.assigned_to,OLD.assigned_by,OLD.deadline) THEN RETURN NEW; END IF;
    END IF;
    IF EXISTS (SELECT 1 FROM staff_substitutions WHERE business_context='event_genix'
        AND source_type='chat_task' AND source_id=OLD.id::text AND state='active'
        AND id::text IS DISTINCT FROM current_setting('eventgenix.substitution_command',true)) THEN
        RAISE EXCEPTION 'Chat task has an agreed substitution'
            USING ERRCODE='23514', CONSTRAINT='staff_substitution_chat_task_active_guard';
    END IF;
    IF TG_OP='DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END;
$function$;

DO $migration$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='chat_task_substitution_guard_v402' AND tgrelid='chat_tasks'::regclass) THEN
        CREATE TRIGGER chat_task_substitution_guard_v402 BEFORE UPDATE OR DELETE ON chat_tasks
            FOR EACH ROW EXECUTE FUNCTION guard_staff_substitution_chat_task_v402();
    END IF;
END;
$migration$;
