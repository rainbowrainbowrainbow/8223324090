-- MIGRATION_KIND: schema
-- SAFETY: Adds guards for new Park cross-date remainder plans. No schedule or payroll rows are changed.
-- ROLLBACK: Preserve the guards and evidence. Resolve active cross-date agreements before reverting application support.

CREATE INDEX IF NOT EXISTS idx_staff_substitution_cross_date_remainder
    ON staff_substitutions(original_staff_id, (source_snapshot->'remainder'->>'date'))
    WHERE business_context='event_genix' AND source_type='hr_shift' AND slot_key='partial'
      AND state<>'cancelled' AND source_snapshot ? 'remainder';

CREATE OR REPLACE FUNCTION guard_staff_substitution_cross_date_remainder_v412()
RETURNS TRIGGER LANGUAGE plpgsql AS $function$
DECLARE
    old_worker INTEGER;
    new_worker INTEGER;
    old_date TEXT;
    new_date TEXT;
    old_parent BIGINT;
    new_parent BIGINT;
    claim_id BIGINT;
BEGIN
    IF TG_TABLE_NAME = 'hr_shifts' THEN
        IF TG_OP = 'UPDATE' AND
            (NEW.staff_id, NEW.shift_date, NEW.planned_start, NEW.planned_end, NEW.break_minutes, NEW.shift_type, NEW.profession_key)
            IS NOT DISTINCT FROM
            (OLD.staff_id, OLD.shift_date, OLD.planned_start, OLD.planned_end, OLD.break_minutes, OLD.shift_type, OLD.profession_key) THEN
            RETURN NEW;
        END IF;
        IF TG_OP <> 'INSERT' THEN
            old_worker := OLD.staff_id;
            old_date := OLD.shift_date::text;
        END IF;
        IF TG_OP <> 'DELETE' THEN
            new_worker := NEW.staff_id;
            new_date := NEW.shift_date::text;
        END IF;
    ELSIF TG_TABLE_NAME = 'staff_schedule' THEN
        IF TG_OP = 'UPDATE' AND
            (NEW.staff_id, NEW.date, NEW.shift_start, NEW.shift_end, NEW.status, NEW.profession_key)
            IS NOT DISTINCT FROM
            (OLD.staff_id, OLD.date, OLD.shift_start, OLD.shift_end, OLD.status, OLD.profession_key) THEN
            RETURN NEW;
        END IF;
        IF TG_OP <> 'INSERT' THEN
            old_worker := OLD.staff_id;
            old_date := LEFT(OLD.date::text, 10);
        END IF;
        IF TG_OP <> 'DELETE' THEN
            new_worker := NEW.staff_id;
            new_date := LEFT(NEW.date::text, 10);
        END IF;
    ELSE
        IF TG_TABLE_NAME = 'hr_shift_segments' THEN
            IF TG_OP <> 'INSERT' THEN old_parent := OLD.hr_shift_id; END IF;
            IF TG_OP <> 'DELETE' THEN new_parent := NEW.hr_shift_id; END IF;
        ELSE
            IF TG_OP <> 'INSERT' THEN
                SELECT hr_shift_id INTO old_parent FROM hr_shift_segments WHERE id=OLD.segment_id;
            END IF;
            IF TG_OP <> 'DELETE' THEN
                SELECT hr_shift_id INTO new_parent FROM hr_shift_segments WHERE id=NEW.segment_id;
            END IF;
        END IF;
        SELECT staff_id, shift_date::text INTO old_worker, old_date FROM hr_shifts WHERE id=old_parent;
        SELECT staff_id, shift_date::text INTO new_worker, new_date FROM hr_shifts WHERE id=new_parent;
    END IF;

    FOR claim_id IN
        SELECT id FROM staff_substitutions
        WHERE business_context='event_genix' AND source_type='hr_shift' AND slot_key='partial'
          AND state<>'cancelled' AND source_snapshot ? 'remainder'
          AND ((original_staff_id=old_worker AND source_snapshot->'remainder'->>'date'=old_date)
            OR (original_staff_id=new_worker AND source_snapshot->'remainder'->>'date'=new_date))
    LOOP
        IF COALESCE(current_setting('eventgenix.substitution_command', true), '') <> claim_id::text THEN
            RAISE EXCEPTION 'Shift has an agreed substitution; use its audited workflow'
                USING ERRCODE='23514', CONSTRAINT='staff_substitution_cross_date_remainder_guard';
        END IF;
    END LOOP;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE TRIGGER hr_shift_cross_date_remainder_guard_v412
    BEFORE INSERT OR UPDATE OR DELETE ON hr_shifts FOR EACH ROW
    EXECUTE FUNCTION guard_staff_substitution_cross_date_remainder_v412();
CREATE OR REPLACE TRIGGER hr_segment_cross_date_remainder_guard_v412
    BEFORE INSERT OR UPDATE OR DELETE ON hr_shift_segments FOR EACH ROW
    EXECUTE FUNCTION guard_staff_substitution_cross_date_remainder_v412();
CREATE OR REPLACE TRIGGER hr_segment_role_cross_date_remainder_guard_v412
    BEFORE INSERT OR UPDATE OR DELETE ON hr_shift_segment_roles FOR EACH ROW
    EXECUTE FUNCTION guard_staff_substitution_cross_date_remainder_v412();
CREATE OR REPLACE TRIGGER staff_schedule_cross_date_remainder_guard_v412
    AFTER INSERT OR UPDATE OR DELETE ON staff_schedule FOR EACH ROW
    EXECUTE FUNCTION guard_staff_substitution_cross_date_remainder_v412();
