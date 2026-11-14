-- MIGRATION_KIND: schema
-- SAFETY: Adds guards for partial shift claims; no existing schedule or payroll rows are changed.
-- ROLLBACK: Keep the guards and history for accepted partial claims when rolling back application code.

CREATE OR REPLACE FUNCTION guard_staff_substitution_partial_shift_v393()
RETURNS TRIGGER LANGUAGE plpgsql AS $function$
DECLARE
    parent_id BIGINT;
    old_parent_id BIGINT;
    plan_worker INTEGER;
    plan_date DATE;
    claim_id BIGINT;
BEGIN
    IF TG_TABLE_NAME = 'hr_shifts' THEN
        IF TG_OP = 'UPDATE' THEN
            IF (NEW.staff_id, NEW.shift_date, NEW.planned_start, NEW.planned_end, NEW.break_minutes, NEW.shift_type, NEW.profession_key)
               IS NOT DISTINCT FROM
               (OLD.staff_id, OLD.shift_date, OLD.planned_start, OLD.planned_end, OLD.break_minutes, OLD.shift_type, OLD.profession_key) THEN
                RETURN NEW;
            END IF;
        END IF;
        IF TG_OP <> 'DELETE' THEN
            parent_id := NEW.id;
        END IF;
        IF TG_OP <> 'INSERT' THEN
            old_parent_id := OLD.id;
            plan_worker := OLD.staff_id;
            plan_date := OLD.shift_date;
        END IF;
    ELSIF TG_TABLE_NAME = 'hr_shift_segments' THEN
        IF TG_OP <> 'DELETE' THEN parent_id := NEW.hr_shift_id; END IF;
        IF TG_OP <> 'INSERT' THEN old_parent_id := OLD.hr_shift_id; END IF;
    ELSE
        IF TG_OP <> 'DELETE' THEN
            SELECT hr_shift_id INTO parent_id FROM hr_shift_segments WHERE id=NEW.segment_id;
        END IF;
        IF TG_OP <> 'INSERT' THEN
            SELECT hr_shift_id INTO old_parent_id FROM hr_shift_segments WHERE id=OLD.segment_id;
        END IF;
    END IF;

    FOR claim_id IN
        SELECT ss.id FROM staff_substitutions ss
        WHERE ss.source_type='hr_shift' AND ss.slot_key='partial' AND ss.state<>'cancelled'
          AND (
            ss.source_id IN (parent_id::text, old_parent_id::text)
            OR (ss.staff_id=plan_worker AND ss.work_date=plan_date)
            OR EXISTS (SELECT 1 FROM hr_shifts hs WHERE hs.id IN (parent_id, old_parent_id)
                AND hs.staff_id=ss.staff_id AND hs.shift_date=ss.work_date)
          )
    LOOP
        IF COALESCE(current_setting('eventgenix.substitution_command', true), '') <> claim_id::text THEN
            RAISE EXCEPTION 'Shift has an agreed substitution; use its audited workflow' USING ERRCODE='23514';
        END IF;
    END LOOP;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END;
$function$;

DO $migration$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='hr_shift_partial_substitution_guard_v393' AND tgrelid='hr_shifts'::regclass) THEN
        CREATE TRIGGER hr_shift_partial_substitution_guard_v393 BEFORE UPDATE OR DELETE ON hr_shifts
            FOR EACH ROW EXECUTE FUNCTION guard_staff_substitution_partial_shift_v393();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='hr_segment_partial_substitution_guard_v393' AND tgrelid='hr_shift_segments'::regclass) THEN
        CREATE TRIGGER hr_segment_partial_substitution_guard_v393 BEFORE INSERT OR UPDATE OR DELETE ON hr_shift_segments
            FOR EACH ROW EXECUTE FUNCTION guard_staff_substitution_partial_shift_v393();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='hr_segment_role_partial_substitution_guard_v393' AND tgrelid='hr_shift_segment_roles'::regclass) THEN
        CREATE TRIGGER hr_segment_role_partial_substitution_guard_v393 BEFORE INSERT OR UPDATE OR DELETE ON hr_shift_segment_roles
            FOR EACH ROW EXECUTE FUNCTION guard_staff_substitution_partial_shift_v393();
    END IF;
END;
$migration$;
