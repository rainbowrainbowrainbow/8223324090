-- MIGRATION_KIND: schema
-- SAFETY: Adds onboarding substitution source and alias guards without updating existing records.
-- ROLLBACK: Keep the guards until active onboarding substitutions are resolved.

CREATE UNIQUE INDEX IF NOT EXISTS uq_staff_substitution_onboarding_v398
    ON staff_substitutions(business_context,source_id)
    WHERE source_type='onboarding' AND state<>'cancelled';

CREATE OR REPLACE FUNCTION guard_staff_substitution_onboarding_v398()
RETURNS TRIGGER LANGUAGE plpgsql AS $function$
BEGIN
    IF TG_TABLE_NAME = 'onboarding_progress' THEN
        IF TG_OP = 'UPDATE' THEN
            IF (NEW.id,NEW.staff_id,NEW.profession_key,NEW.responsible_user_id) IS NOT DISTINCT FROM
               (OLD.id,OLD.staff_id,OLD.profession_key,OLD.responsible_user_id) THEN RETURN NEW; END IF;
        END IF;
        IF EXISTS (SELECT 1 FROM staff_substitutions WHERE business_context='event_genix'
            AND source_type='onboarding' AND source_id=OLD.id::text AND state='active'
            AND id::text IS DISTINCT FROM current_setting('eventgenix.substitution_command',true)) THEN
            RAISE EXCEPTION 'Onboarding has an agreed substitution'
                USING ERRCODE='23514', CONSTRAINT='staff_substitution_onboarding_active_guard';
        END IF;
        IF TG_OP='DELETE' THEN RETURN OLD; END IF;
    ELSIF TG_TABLE_NAME = 'tasks' THEN
        IF (NEW.source_type='onboarding' OR NEW.source_module='hr_onboarding')
            AND (NEW.source_type,NEW.source_id,NEW.source_module,NEW.related_entity_type,NEW.related_entity_id)
             IS DISTINCT FROM (OLD.source_type,OLD.source_id,OLD.source_module,OLD.related_entity_type,OLD.related_entity_id)
            AND EXISTS (SELECT 1 FROM staff_substitutions WHERE source_type='task' AND source_id=NEW.id::text AND state<>'cancelled') THEN
            RAISE EXCEPTION 'An onboarding task has one substitution source'
                USING ERRCODE='23514', CONSTRAINT='staff_substitution_onboarding_alias_guard';
        END IF;
    ELSIF NEW.source_type='task' AND EXISTS (SELECT 1 FROM tasks WHERE id::text=NEW.source_id
         AND (source_type='onboarding' OR source_module='hr_onboarding')) THEN
        RAISE EXCEPTION 'An onboarding task has one substitution source'
            USING ERRCODE='23514', CONSTRAINT='staff_substitution_onboarding_alias_guard';
    END IF;
    RETURN NEW;
END;
$function$;

DO $migration$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='onboarding_substitution_guard_v398' AND tgrelid='onboarding_progress'::regclass) THEN
        CREATE TRIGGER onboarding_substitution_guard_v398 BEFORE UPDATE OR DELETE ON onboarding_progress
            FOR EACH ROW EXECUTE FUNCTION guard_staff_substitution_onboarding_v398();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='onboarding_task_claim_guard_v398' AND tgrelid='staff_substitutions'::regclass) THEN
        CREATE TRIGGER onboarding_task_claim_guard_v398 BEFORE INSERT ON staff_substitutions
            FOR EACH ROW EXECUTE FUNCTION guard_staff_substitution_onboarding_v398();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='onboarding_task_alias_guard_v398' AND tgrelid='tasks'::regclass) THEN
        CREATE TRIGGER onboarding_task_alias_guard_v398 BEFORE UPDATE OF source_type,source_id,source_module,related_entity_type,related_entity_id ON tasks
            FOR EACH ROW EXECUTE FUNCTION guard_staff_substitution_onboarding_v398();
    END IF;
END;
$migration$;
