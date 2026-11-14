-- MIGRATION_KIND: schema
-- SAFETY: Adds claim uniqueness and meeting action guards without changing existing records.
-- ROLLBACK: Keep the guards until active meeting action substitutions are resolved.

CREATE UNIQUE INDEX IF NOT EXISTS uq_staff_substitution_meeting_action_v403
    ON staff_substitutions(business_context,source_id)
    WHERE source_type='meeting_action' AND state<>'cancelled';

CREATE INDEX IF NOT EXISTS idx_tasks_meeting_action_source_v403 ON tasks(source_id)
    WHERE source_type='meeting_action';

CREATE OR REPLACE FUNCTION guard_staff_substitution_meeting_action_v403()
RETURNS TRIGGER LANGUAGE plpgsql AS $function$
DECLARE
    action_id INTEGER;
    linked_task_id INTEGER;
    action_pending BOOLEAN;
BEGIN
    IF TG_TABLE_NAME='staff_substitutions' THEN
        IF NEW.source_type='meeting_action' THEN
            SELECT a.id, a.task_id, COALESCE(a.status,'pending')='pending' INTO action_id, linked_task_id, action_pending
              FROM meeting_action_items a WHERE a.id::text=NEW.source_id FOR UPDATE;
            IF action_id IS NULL OR NOT action_pending OR linked_task_id IS NOT NULL
                OR EXISTS (SELECT 1 FROM tasks WHERE source_type='meeting_action' AND source_id=NEW.source_id) THEN
                RAISE EXCEPTION 'Meeting action is already converted'
                    USING ERRCODE='23514', CONSTRAINT='staff_substitution_meeting_alias_guard';
            END IF;
        ELSIF NEW.source_type='task' AND EXISTS (
            SELECT 1 FROM tasks t JOIN meeting_action_items a ON
                a.task_id=t.id OR (t.source_type='meeting_action' AND t.source_id=a.id::text)
            JOIN staff_substitutions ss ON ss.source_id=a.id::text AND ss.source_type='meeting_action' AND ss.state<>'cancelled'
            WHERE t.id::text=NEW.source_id
        ) THEN
            RAISE EXCEPTION 'Meeting action already has a substitution'
                USING ERRCODE='23514', CONSTRAINT='staff_substitution_meeting_alias_guard';
        END IF;
        RETURN NEW;
    END IF;

    IF TG_TABLE_NAME='tasks' THEN
        IF NEW.source_type IS DISTINCT FROM 'meeting_action' OR NEW.source_id IS NULL THEN RETURN NEW; END IF;
        IF TG_OP='UPDATE' AND (NEW.source_type,NEW.source_id) IS NOT DISTINCT FROM (OLD.source_type,OLD.source_id) THEN
            RETURN NEW;
        END IF;
        SELECT a.id INTO action_id FROM meeting_action_items a WHERE a.id::text=NEW.source_id FOR UPDATE;
    ELSE
        IF TG_OP='UPDATE' AND (NEW.meeting_id,NEW.assigned_to,NEW.due_date,NEW.task_id,NEW.status)
            IS NOT DISTINCT FROM (OLD.meeting_id,OLD.assigned_to,OLD.due_date,OLD.task_id,OLD.status) THEN RETURN NEW; END IF;
        action_id := OLD.id;
    END IF;

    IF EXISTS (SELECT 1 FROM staff_substitutions WHERE business_context='event_genix'
        AND source_type='meeting_action' AND source_id=action_id::text
        AND (state='active' OR (TG_TABLE_NAME='tasks' AND state='completed'))
        AND id::text IS DISTINCT FROM current_setting('eventgenix.substitution_command',true)) THEN
        RAISE EXCEPTION 'Meeting action has an agreed substitution'
            USING ERRCODE='23514', CONSTRAINT='staff_substitution_meeting_active_guard';
    END IF;
    IF TG_OP='DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END;
$function$;

DO $migration$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='meeting_action_substitution_guard_v403' AND tgrelid='meeting_action_items'::regclass) THEN
        CREATE TRIGGER meeting_action_substitution_guard_v403 BEFORE UPDATE OR DELETE ON meeting_action_items
            FOR EACH ROW EXECUTE FUNCTION guard_staff_substitution_meeting_action_v403();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='meeting_task_substitution_guard_v403' AND tgrelid='tasks'::regclass) THEN
        CREATE TRIGGER meeting_task_substitution_guard_v403 BEFORE INSERT OR UPDATE OF source_type,source_id ON tasks
            FOR EACH ROW EXECUTE FUNCTION guard_staff_substitution_meeting_action_v403();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='meeting_action_alias_guard_v403' AND tgrelid='staff_substitutions'::regclass) THEN
        CREATE TRIGGER meeting_action_alias_guard_v403 BEFORE INSERT ON staff_substitutions
            FOR EACH ROW EXECUTE FUNCTION guard_staff_substitution_meeting_action_v403();
    END IF;
END;
$migration$;
