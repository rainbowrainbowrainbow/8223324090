-- MIGRATION_KIND: schema
-- SAFETY: Prevents new duplicate claims across leads and generated tasks; no existing rows are updated.
-- ROLLBACK: Keep the guard while the lead and task adapters accept claims independently.

CREATE OR REPLACE FUNCTION guard_staff_substitution_lead_alias_v396()
RETURNS TRIGGER LANGUAGE plpgsql AS $function$
DECLARE
    lead_ids TEXT[];
    task_id TEXT;
    company TEXT;
BEGIN
    IF TG_TABLE_NAME = 'staff_substitutions' THEN
        IF NEW.source_type = 'lead' THEN
            company := NEW.business_context;
            lead_ids := ARRAY[NEW.source_id];
        ELSIF NEW.source_type = 'task' THEN
            company := NEW.business_context;
            task_id := NEW.source_id;
            PERFORM 1 FROM tasks WHERE id::text=task_id FOR NO KEY UPDATE;
            SELECT ARRAY[CASE WHEN t.source_type='lead' THEN t.source_id END,
                CASE WHEN t.source_entity_type='lead' THEN t.source_entity_id END]
            INTO lead_ids FROM tasks t WHERE t.id::text=task_id AND COALESCE(t.business_context,'event_genix')=company;
        ELSE
            RETURN NEW;
        END IF;
    ELSE
        IF (NEW.source_type,NEW.source_id,NEW.source_entity_type,NEW.source_entity_id,NEW.business_context)
            IS NOT DISTINCT FROM (OLD.source_type,OLD.source_id,OLD.source_entity_type,OLD.source_entity_id,OLD.business_context) THEN
            RETURN NEW;
        END IF;
        task_id := NEW.id::text;
        company := COALESCE(NEW.business_context,'event_genix');
        lead_ids := ARRAY[CASE WHEN NEW.source_type='lead' THEN NEW.source_id END,
            CASE WHEN NEW.source_entity_type='lead' THEN NEW.source_entity_id END];
        IF NOT EXISTS (SELECT 1 FROM staff_substitutions ss
            WHERE ss.source_type='task' AND ss.source_id=task_id AND ss.business_context=company AND ss.state<>'cancelled') THEN
            RETURN NEW;
        END IF;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM unnest(lead_ids) AS source(id) WHERE source.id IS NOT NULL) THEN RETURN NEW; END IF;
    PERFORM 1 FROM leads l WHERE l.id::text=ANY(lead_ids) AND COALESCE(l.business_context,'event_genix')=company ORDER BY l.id FOR NO KEY UPDATE;
    IF (task_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM staff_substitutions ss WHERE ss.business_context=company AND ss.state<>'cancelled'
            AND ss.source_type='lead' AND ss.source_id=ANY(lead_ids)
    )) OR (task_id IS NULL AND EXISTS (
        SELECT 1 FROM staff_substitutions ss JOIN tasks t ON t.id::text=ss.source_id
        WHERE ss.business_context=company AND ss.state<>'cancelled' AND ss.source_type='task'
            AND COALESCE(t.business_context,'event_genix')=company
            AND ((t.source_type='lead' AND t.source_id=ANY(lead_ids))
              OR (t.source_entity_type='lead' AND t.source_entity_id=ANY(lead_ids)))
    )) THEN
        RAISE EXCEPTION 'Lead work has one agreed substitution source'
            USING ERRCODE='23514', CONSTRAINT='staff_substitution_lead_alias_guard';
    END IF;
    RETURN NEW;
END;
$function$;

DO $migration$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='staff_substitution_lead_alias_guard_v396' AND tgrelid='staff_substitutions'::regclass) THEN
        CREATE TRIGGER staff_substitution_lead_alias_guard_v396 BEFORE INSERT ON staff_substitutions
            FOR EACH ROW EXECUTE FUNCTION guard_staff_substitution_lead_alias_v396();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='task_substitution_lead_alias_guard_v396' AND tgrelid='tasks'::regclass) THEN
        CREATE TRIGGER task_substitution_lead_alias_guard_v396 BEFORE UPDATE OF source_type,source_id,source_entity_type,source_entity_id,business_context ON tasks
            FOR EACH ROW EXECUTE FUNCTION guard_staff_substitution_lead_alias_v396();
    END IF;
END;
$migration$;
