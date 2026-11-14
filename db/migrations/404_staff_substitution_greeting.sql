-- MIGRATION_KIND: schema
-- SAFETY: Guards timing of an Afisha greeting while its substitution is active; updates no existing rows.
-- ROLLBACK: Retain the guards until active greeting substitutions are resolved.

CREATE OR REPLACE FUNCTION guard_afisha_greeting_substitution_v399()
RETURNS TRIGGER LANGUAGE plpgsql AS $function$
DECLARE
    event_ids INTEGER[];
BEGIN
    IF TG_TABLE_NAME = 'afisha' THEN
        IF (NEW.type,NEW.original_time) IS NOT DISTINCT FROM (OLD.type,OLD.original_time) THEN RETURN NEW; END IF;
        event_ids := ARRAY[OLD.id];
    ELSIF TG_OP = 'INSERT' THEN
        event_ids := ARRAY[NEW.afisha_id];
    ELSE
        IF TG_OP = 'UPDATE' THEN
            IF (NEW.afisha_id,NEW.slot_key,NEW.time,NEW.mode)
                IS NOT DISTINCT FROM (OLD.afisha_id,OLD.slot_key,OLD.time,OLD.mode) THEN RETURN NEW; END IF;
        END IF;
        event_ids := ARRAY[OLD.afisha_id];
        IF TG_OP='UPDATE' THEN event_ids := array_append(event_ids, NEW.afisha_id); END IF;
    END IF;

    PERFORM 1 FROM afisha WHERE id=ANY(event_ids) ORDER BY id FOR NO KEY UPDATE;
    IF EXISTS (SELECT 1 FROM staff_substitutions WHERE business_context='event_genix'
        AND source_type='afisha' AND source_id=ANY(event_ids::text[]) AND state='active'
        AND source_snapshot->'event'->>'type'='greeting') THEN
        RAISE EXCEPTION 'Greeting has an agreed substitution'
            USING ERRCODE='23514', CONSTRAINT='afisha_greeting_substitution_active_guard';
    END IF;
    IF TG_OP='DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END;
$function$;

DO $migration$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='afisha_greeting_slot_substitution_guard_v399' AND tgrelid='afisha_birthday_slots'::regclass) THEN
        CREATE TRIGGER afisha_greeting_slot_substitution_guard_v399
            BEFORE INSERT OR UPDATE OR DELETE ON afisha_birthday_slots FOR EACH ROW
            EXECUTE FUNCTION guard_afisha_greeting_substitution_v399();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='afisha_greeting_type_substitution_guard_v399' AND tgrelid='afisha'::regclass) THEN
        CREATE TRIGGER afisha_greeting_type_substitution_guard_v399
            BEFORE UPDATE OF type,original_time ON afisha FOR EACH ROW EXECUTE FUNCTION guard_afisha_greeting_substitution_v399();
    END IF;
END;
$migration$;
