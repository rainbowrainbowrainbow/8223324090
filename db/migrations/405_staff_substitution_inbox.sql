-- MIGRATION_KIND: schema
-- SAFETY: Guards an active substitution of the Omni conversation assignee. Existing conversations are unchanged.
-- ROLLBACK: Retain the guard until active conversation substitutions are resolved.

CREATE UNIQUE INDEX IF NOT EXISTS uq_staff_substitution_inbox_v400
    ON staff_substitutions(business_context,source_id)
    WHERE source_type='inbox' AND state<>'cancelled';

CREATE OR REPLACE FUNCTION guard_staff_substitution_inbox_v400()
RETURNS TRIGGER LANGUAGE plpgsql AS $function$
BEGIN
    IF TG_OP='UPDATE' THEN
        IF (NEW.id,NEW.business_context,NEW.assigned_to) IS NOT DISTINCT FROM (OLD.id,OLD.business_context,OLD.assigned_to) THEN RETURN NEW; END IF;
    END IF;
    IF EXISTS (SELECT 1 FROM staff_substitutions WHERE business_context=COALESCE(OLD.business_context,'event_genix')
        AND source_type='inbox' AND source_id=OLD.id::text AND state='active'
        AND id::text IS DISTINCT FROM current_setting('eventgenix.substitution_command',true)) THEN
        RAISE EXCEPTION 'Conversation has an agreed substitution'
            USING ERRCODE='23514', CONSTRAINT='staff_substitution_inbox_active_guard';
    END IF;
    IF TG_OP='DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END;
$function$;

DO $migration$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='inbox_substitution_guard_v400' AND tgrelid='conversations'::regclass) THEN
        CREATE TRIGGER inbox_substitution_guard_v400 BEFORE UPDATE OR DELETE ON conversations
            FOR EACH ROW EXECUTE FUNCTION guard_staff_substitution_inbox_v400();
    END IF;
END;
$migration$;
